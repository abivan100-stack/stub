import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'

// Two isolated browser contexts play the two phones. They pair through the text fallback
// (the same codes the QR carries), then send a file end to end over a real RTCDataChannel.

const shots = process.env.SHOTS // set SHOTS=dir to save screenshots of each screen

async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true })
}

async function copyCode(page: Page): Promise<string> {
  await page.getByText(/Can’t scan\? Send the code as text/).click()
  const code = await page.getByTestId('code-out').inputValue()
  expect(code).toMatch(/^[oa][A-Za-z0-9_-]+$/)
  return code
}

async function pasteCode(page: Page, code: string) {
  await page.getByText(/Can’t scan\? Paste their code/).click()
  await page.getByTestId('code-in').fill(code)
  await page.getByRole('button', { name: 'Use this code' }).click()
}

test('pairs two devices and sends a verified file', async ({ browser }) => {
  const opts = { permissions: ['camera'] }
  const alice = await (await browser.newContext(opts)).newPage()
  const bob = await (await browser.newContext(opts)).newPage()
  for (const [who, p] of [['alice', alice], ['bob', bob]] as const) {
    p.on('pageerror', (e) => console.log(`[${who}] pageerror`, e.message))
    p.on('console', (m) => m.type() === 'error' && console.log(`[${who}]`, m.text()))
  }

  await alice.goto('/')
  await shot(alice, '1-home')
  await alice.getByRole('button', { name: /^Send/ }).click()
  await expect(alice.getByRole('img', { name: /Pairing code/ })).toBeVisible()
  const offer = await copyCode(alice)
  await shot(alice, '2-send-step1')
  await alice.getByRole('button', { name: 'They scanned it. Next' }).click()

  await bob.goto('/')
  await bob.getByRole('button', { name: /^Receive/ }).click()
  await shot(bob, '3-receive-step1')
  await pasteCode(bob, offer)
  await expect(bob.getByText('Waiting for them to scan')).toBeVisible()
  const answer = await copyCode(bob)
  await shot(bob, '4-receive-step2')

  await pasteCode(alice, answer)

  // Both screens show the same verification code.
  const code = alice.locator('.sr-only', { hasText: 'Your code is' })
  await expect(code).toBeAttached({ timeout: 20_000 })
  const shown = await code.textContent()
  await expect(bob.locator('.sr-only', { hasText: 'Your code is' })).toHaveText(shown!)
  await alice.waitForTimeout(1200) // let the digits finish printing for the screenshot
  await shot(alice, '5-verify')
  await alice.getByRole('button', { name: 'Match', exact: true }).click()
  await bob.getByRole('button', { name: 'Match', exact: true }).click()
  await expect(alice.getByText('Nothing sent yet')).toBeVisible()
  await shot(alice, '6-transfer-empty')

  // 1.5 MB of patterned bytes, so a corrupted or reordered chunk would show.
  const data = Buffer.alloc(1_500_000)
  for (let i = 0; i < data.length; i++) data[i] = (i * 7 + (i >> 9)) & 0xff
  await alice.getByTestId('file-input').setInputFiles([
    { name: 'site-survey.pdf', mimeType: 'application/pdf', buffer: data },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('meet at the north gate') },
  ])
  await expect(alice.getByText('2 files, 1.5 MB. Send?')).toBeVisible()
  await shot(alice, '7-send-confirm')
  await alice.getByRole('button', { name: 'Send', exact: true }).click()

  await expect(bob.getByText('2 files, 1.5 MB. Accept?')).toBeVisible()
  await shot(bob, '8-accept')
  await bob.getByRole('button', { name: 'Accept' }).click()

  await expect(bob.getByRole('heading', { name: 'All done' })).toBeVisible({ timeout: 30_000 })
  await expect(alice.getByRole('heading', { name: 'All done' })).toBeVisible()
  await shot(bob, '9-done')

  const download = bob.waitForEvent('download')
  await bob.getByRole('link', { name: 'Save site-survey.pdf' }).click()
  const got = await readFile(await (await download).path())
  expect(got.equals(data)).toBe(true)

  await bob.getByRole('button', { name: 'Send more' }).click()
  await expect(bob.getByRole('article', { name: /site-survey\.pdf, Verified/ })).toBeVisible()
  await bob.waitForTimeout(400)
  await shot(bob, '10-queue')
})

test('a Wi-Fi code from a hotspot shows join-by-hand details on the web', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /^Receive/ }).click()
  await pasteCode(page, 'WIFI:T:WPA;S:AndroidShare_4821;P:k3x9q2mp;;')
  await expect(page.getByText('Join this Wi-Fi in your phone’s settings')).toBeVisible()
  await expect(page.getByText('AndroidShare_4821')).toBeVisible()
  await expect(page.getByText('k3x9q2mp')).toBeVisible()
  // The scanner is ready again for the Stub code.
  await expect(page.getByText(/Can’t scan\? Paste their code/)).toBeVisible()
})

test('when the other device is unreachable, the error screen shows connection details', async ({ browser }) => {
  const opts = { permissions: ['camera'] }
  const alice = await (await browser.newContext(opts)).newPage()
  const bob = await (await browser.newContext(opts)).newPage()
  await alice.goto('/')
  await alice.getByRole('button', { name: /^Send/ }).click()
  const offer = await copyCode(alice)
  await alice.close() // the sender disappears before the receiver answers

  await bob.goto('/')
  await bob.getByRole('button', { name: /^Receive/ }).click()
  await pasteCode(bob, offer)
  // Either the 20-second timeout or an outright ICE failure, depending on how fast the browser gives up.
  await expect(bob.getByRole('heading', { name: /Couldn’t reach the other device|The connection failed/ })).toBeVisible({
    timeout: 30_000,
  })
  await bob.getByText('Details for troubleshooting').click()
  await expect(bob.getByText(/This device: .*\(udp\)/)).toBeVisible()
  await expect(bob.getByText(/Other device: .*\(udp\)/)).toBeVisible()
  await shot(bob, 'error-details')
})

// This PC's LAN address. Loading Stub from it over http gives a real insecure context (no WebCrypto,
// no camera), which is what a laptop gets when it opens the address shown on a Stub phone.
const lan = Object.values(networkInterfaces())
  .flat()
  .find((a) => a && a.family === 'IPv4' && !a.internal)?.address

test('a laptop pairs through the phone with a PIN, without scanning', async ({ browser }) => {
  test.skip(!lan, 'needs a LAN address')
  const phone = await (await browser.newContext({ permissions: ['camera'] })).newPage()
  const laptop = await (await browser.newContext()).newPage()

  // Stand-in for the phone's StubHostServer: check the PIN, let the phone page answer the offer.
  await laptop.route('**/__stub/host', (r) => r.fulfill({ body: 'stub' }))
  await laptop.route('**/__stub/pair', async (r) => {
    const [pin, offer] = r.request().postData()!.split('\n')
    if (pin !== '4821') return r.fulfill({ status: 403, body: "That PIN doesn't match. Check the phone." })
    await phone.goto('/')
    await phone.getByRole('button', { name: /^Receive/ }).click()
    await pasteCode(phone, offer!)
    await expect(phone.getByText('Waiting for them to scan')).toBeVisible()
    await r.fulfill({ body: await copyCode(phone) })
  })

  await laptop.goto(`http://${lan}:5174/`)
  expect(await laptop.evaluate(() => isSecureContext)).toBe(false)
  await expect(laptop.getByRole('heading', { name: 'Enter the PIN on the phone' })).toBeVisible()

  await laptop.getByLabel('PIN').fill('1234')
  await laptop.getByRole('button', { name: 'Connect' }).click()
  await expect(laptop.getByText("That PIN doesn't match. Check the phone.")).toBeVisible()

  await laptop.getByLabel('PIN').fill('4821')
  await laptop.getByRole('button', { name: 'Connect' }).click()

  const code = laptop.locator('.sr-only', { hasText: 'Your code is' })
  await expect(code).toBeAttached({ timeout: 20_000 })
  await expect(phone.locator('.sr-only', { hasText: 'Your code is' })).toHaveText((await code.textContent())!)
  await laptop.getByRole('button', { name: 'Match', exact: true }).click()
  await phone.getByRole('button', { name: 'Match', exact: true }).click()

  // The laptop hashes every chunk with the JS SHA-256 fallback; the phone checks with WebCrypto.
  const data = Buffer.alloc(300_000)
  for (let i = 0; i < data.length; i++) data[i] = (i * 13 + (i >> 8)) & 0xff
  await laptop.getByTestId('file-input').setInputFiles([{ name: 'plan.bin', mimeType: 'application/octet-stream', buffer: data }])
  await laptop.getByRole('button', { name: 'Send', exact: true }).click()
  await phone.getByRole('button', { name: 'Accept' }).click()
  await expect(phone.getByRole('heading', { name: 'All done' })).toBeVisible({ timeout: 30_000 })
  const download = phone.waitForEvent('download')
  await phone.getByRole('link', { name: 'Save plan.bin' }).click()
  expect((await readFile(await (await download).path())).equals(data)).toBe(true)
})

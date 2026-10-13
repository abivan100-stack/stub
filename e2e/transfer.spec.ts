import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

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

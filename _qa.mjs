export default async function run(page) {
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 25000 })
  await page.waitForTimeout(2500)
  return await page.evaluate(() => {
    const hits = []
    for (const sheet of document.styleSheets) {
      let rules
      try { rules = sheet.cssRules } catch { continue }
      const walk = (list) => {
        for (const rule of list) {
          if (rule.media && rule.cssRules) { walk(rule.cssRules); continue }
          const css = rule.cssText || ''
          if (css.includes('grid-template-columns') && (css.includes('repeat(') || css.includes('grid-cols'))) {
            hits.push({ sel: rule.selectorText || rule.conditionText || '', css: css.slice(0, 220) })
          }
        }
      }
      walk(rules)
    }
    const probe = [...document.querySelectorAll('div')].find((d) => (d.className || '').toString().includes('lg:grid-cols-4'))
    const matching = []
    if (probe) {
      for (const sheet of document.styleSheets) {
        let rules
        try { rules = sheet.cssRules } catch { continue }
        for (const rule of rules) {
          if (rule.media) continue
          try { if (probe.matches(rule.selectorText) && rule.cssText.includes('grid-template-columns')) matching.push(rule.cssText.slice(0, 200)) } catch {}
        }
      }
    }
    return {
      probeFound: Boolean(probe),
      probeCls: probe ? (probe.className || '').toString().slice(0, 160) : null,
      probeGridCols: probe ? getComputedStyle(probe).gridTemplateColumns : null,
      rulesFound: hits.length,
      sample: hits.slice(0, 6),
      matching,
    }
  })
}

## Changes Made

### 1. Correct the test `IntersectionObserver` mock typing
- **File:** `student-portal/src/test/setup.ts`
- **Change:** Replace the invalid cast to an `IntersectionObserver` instance with a class implementing the current DOM interface, including `scrollMargin`, and assign its constructor to `globalThis.IntersectionObserver`.
- **Why:** `npm run build` failed with TS2741 because the previous class assertion did not satisfy the current DOM constructor/interface types.
- **Revert:** Restore the prior `global.IntersectionObserver = class ... as unknown as IntersectionObserver` mock.

### 2. Remove an invalid temporary fix script
- **File:** `student-portal/fix_file.cjs` (deleted)
- **Change:** Remove a temporary script with an invalid Unicode escape and unterminated JavaScript source, which produced two Oxlint parsing errors and attempted to rewrite a removed integration test.
- **Why:** `npx oxlint --format=json` identified two parse errors in this unused script. No source references remained.
- **Revert:** Restore only from an external backup if the script is genuinely needed; the integration-test target it referenced is absent.

## Validation
- `Set-Location student-portal; npm run build`: passed. Sass/Bootstrap deprecation and bundle-size advisories remain.
- `Set-Location student-portal; npm run test:run`: passed, 12/12 current tests.
- `npx oxlint --format=json`: 0 errors, 20 warnings.
- `Set-Location backend; python -m compileall -q .`: passed.
- `Set-Location backend; python -m pytest -q`: unavailable because this Python environment has no `pytest` module.
- Archived logs reference `src/App.integration.test.tsx`, which is absent from the current workspace; those historical failures were not treated as current test failures.

## Revert Status
- [ ] Change 1 - Test DOM mock typing
- [ ] Change 2 - Remove invalid temporary script

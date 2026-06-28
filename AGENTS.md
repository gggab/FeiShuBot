# AGENTS.md

## Rule

Docs are the source of truth.

Read first:
- docs/README.md

## Workflow

Feature:
1. Read docs.
2. Plan.
3. Write tests.
4. Implement.
5. Review tests.

Bug:
1. Find root cause.
2. Fix.
3. Verify.

Requirement changes must update:
- docs
- development documents
- tests

## Commands

yarn install
yarn dev
yarn build
yarn type-check

Use Yarn only.

## Commit

<type>: <subject>
Types:
feat fix chore docs style refactor build revert

## Rules

- No fallback code.
- No hidden errors.
- Fix root causes.
- Keep behavior explicit.
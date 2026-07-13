# Releasing ElfUI Language Tools

Run all commands from the repository root on `main`.

## Release Checklist

1. Bump the same version in `package.json` and
   `elfui-language-features-typescript-plugin/package.json`.
2. Run the full verification suite:

   ```powershell
   pnpm typecheck
   pnpm test
   pnpm smoke
   pnpm verify:m10
   pnpm smoke:host
   pnpm package:vsix
   pnpm smoke:vsix
   ```

3. Commit with a Conventional Commit message and push `main` to Gitee and GitHub.
4. Publish the tested package:

   ```powershell
   pnpm exec vsce publish --packagePath ".local-vsix\elfui-language-features-X.Y.Z.vsix"
   ```

The package command performs a build, offline smoke checks, and grammar tests before producing
the VSIX. `smoke:vsix` then launches a real Extension Host from the packaged artifact, which is
the final local release gate.

## Credentials

`vsce` uses the publisher credential stored locally after `vsce login`, or a `VSCE_PAT`
environment variable in automation. The Windows credential-store fallback warning is expected in
some local environments; protect `C:\Users\<user>\.vsce` because its fallback storage is plain
text.

## Optional Automation

Changesets may be used for grouped releases, but the authoritative local workflow remains the
VSIX package and packaged-host verification above. Only create a Git tag or GitHub Release after
the Marketplace publish succeeds.

# Releasing

All user-facing changes require a changeset:

```sh
pnpm changeset
```

When the release batch is ready, run the following from `main`, review the generated
`package.json` and `CHANGELOG.md`, then commit them.

```sh
pnpm release:status
pnpm release:version
pnpm build && pnpm test && pnpm smoke
git tag v<package-version>
git push origin main --tags
```

The tag packages a VSIX, publishes it to the VS Code Marketplace with the `VSCE_PAT`
repository secret, and creates the GitHub Release.

## Marketplace authentication

`VSCE_PAT` is the current short-term bridge. Before Azure DevOps retires global PATs on
December 1, 2026, replace it with Microsoft Entra ID workload identity federation and
publish through `vsce --azure-credential`.

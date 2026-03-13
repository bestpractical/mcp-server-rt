# Building mcp-server-rt

## Prerequisites

- Node.js >= 18
- `@anthropic-ai/mcpb` CLI installed globally: `npm install -g @anthropic-ai/mcpb`

> **Note:** The build and pack scripts require macOS or Linux. The server itself runs on Windows, macOS, and Linux — Windows users should install the pre-built `.mcpb` from the releases page rather than building from source.

## Quick build

```bash
npm install        # Install dependencies
npm run build      # Compile TypeScript → dist/
npm test           # Run tests
npm run pack       # Build .mcpb extension bundle
```

`npm run pack` produces `mcp-server-rt.mcpb` in the project root.

## What `npm run pack` does (manual steps)

If you need to build the `.mcpb` bundle without the script:

```bash
# 1. Compile TypeScript
npm run build

# 2. Create a clean staging directory
rm -rf /tmp/mcp-server-rt-pack
mkdir /tmp/mcp-server-rt-pack

# 4. Copy only the files needed at runtime
cp -r dist data manifest.json icon.png package.json /tmp/mcp-server-rt-pack/

# 5. Install production dependencies only (no devDependencies)
cd /tmp/mcp-server-rt-pack
npm install --omit=dev
cd -

# 6. Pack into .mcpb bundle
mcpb pack /tmp/mcp-server-rt-pack mcp-server-rt.mcpb
```

The staging directory approach ensures the bundle contains only runtime files (~3MB), excluding devDependencies, source files, test files, and local config files like `.mcp.json`.

## Publishing a release

### 1. Prepare

Ensure all changes are committed, tests pass, and version numbers are updated in `package.json`, `manifest.json`, `server.json`, and `CHANGELOG.md`.

```bash
npm run build
npm test
npm run pack          # produces mcp-server-rt.mcpb in the project root
```

### 2. Publish to npm

```bash
npm publish
```

### 3. Create a GitHub release

```bash
gh release create v0.2.1 mcp-server-rt.mcpb \
  --title "v0.2.1" \
  --notes "$(sed -n '/^## \[0.2.1\]/,/^## \[/p' CHANGELOG.md | head -n -1)"
```

Or create the release manually on GitHub and attach `mcp-server-rt.mcpb` as a release asset.

### 4. Update the MCP Registry

```bash
mcp-publisher publish
```

This updates the entry at `registry.modelcontextprotocol.io` to point at the new npm version. Requires the DNS key for `requesttracker.com` — see the DNS verification setup in the registry publishing notes.

---

## Installing the extension

In Claude Desktop or Claude Cowork:

1. Go to **Settings → Extensions**
2. Click **Advanced settings → Extension Developer**
3. Select `mcp-server-rt.mcpb`
4. Enter your RT URL and auth token when prompted (stored in the macOS Keychain)

Create an RT auth token under: **Logged in as → Settings → Auth Tokens**

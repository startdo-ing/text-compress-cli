# Markdown Editor Replication Guide

Guide for replicating the anh.pw markdown editor (Write/Preview tabs, toolbar, image upload, etc.) in another app.

**Source reference:** `apps/site/src/components/MarkdownEditor.svelte`

**Carta GitHub example:** https://github.com/BearToCode/carta/blob/master/docs/src/lib/examples/GitHubExample.svelte

---

## AI / Developer Prompt

Copy everything below the line into your other project's chat or handoff doc.

---

```
Implement a Markdown editor component matching the anh.pw editor UX and behavior.

## Stack & libraries

Use Svelte 5 with these packages (versions from anh.pw):

- `carta-md` (^4.11.2) — markdown editor with Write/Preview tabs
- `@cartamd/plugin-attachment` — paperclip button, drag-drop, paste-to-upload
- `@cartamd/plugin-code` — Shiki syntax highlighting in preview
- `@cartamd/plugin-emoji` — `:emoji:` autocomplete
- `@cartamd/plugin-slash` — `/` slash commands
- `isomorphic-dompurify` — sanitize preview HTML

Import default CSS from each package:
- `carta-md/default.css`
- `@cartamd/plugin-attachment/default.css`
- `@cartamd/plugin-code/default.css`
- `@cartamd/plugin-emoji/default.css`
- `@cartamd/plugin-slash/default.css`

Reference implementation: Carta GitHub example
https://github.com/BearToCode/carta/blob/master/docs/src/lib/examples/GitHubExample.svelte

## Component: MarkdownEditor

Create a reusable `MarkdownEditor.svelte` wrapper around Carta's `MarkdownEditor`.

### Props
- `name` (string, default `"body"`) — hidden input name for form POST
- `value` (bindable string) — markdown content
- `placeholder` (string)
- `minHeight` (string, default `"280px"`)
- `label` (string)
- `required` (boolean)
- `listenForMediaPick` (boolean, default `true`) — listen for media-library pick messages
- `enableAttachment` (boolean, default `true`) — enable/disable attachment plugin

### Exported method
- `appendMarkdown(md: string)` — append markdown at end of value with newline padding

### Carta configuration

```svelte
<CartaMarkdownEditor
  {carta}
  bind:value
  {placeholder}
  theme="github"
  mode="tabs"
  userLabels={{ writeTab: "Write", previewTab: "Preview" }}
/>
```

Initialize Carta in `onMount`:

```ts
carta = new Carta({
  sanitizer: (html) => DOMPurify.sanitize(html),
  extensions: [
    attachment({ ... }),  // if enableAttachment
    emoji(),
    slash(),
    code(),
  ],
})
```

Show a plain `<textarea>` fallback while Carta initializes (`carta` is null).

### Form integration

Include a hidden `<input type="hidden" {name} {value} {required}>` so native form POST works alongside `bind:value`.

## Write / Preview tabs

- `mode="tabs"` — Write and Preview are separate tabs (not split view)
- Tab labels: "Write" and "Preview"
- Toolbar icons hidden on Preview tab (Carta default behavior)
- Style active tab with site design tokens (see Styling below)

## Toolbar features

Default Carta toolbar icons (Write tab only):

| ID | Label | Action |
|----|-------|--------|
| `heading` | Heading | Toggle line prefix `###` |
| `bold` | Bold | Wrap selection with `**` |
| `italic` | Italic | Wrap selection with `*` |
| `strikethrough` | Strikethrough | Wrap selection with `~~` |
| `quote` | Quote | Toggle line prefix `>` |
| `code` | Code | Wrap selection with `` ` `` |
| `link` | Link | Wrap `[...]` and insert `(url)` with URL selected |
| `bulletedList` | Bulleted list | Toggle line prefix `- ` |
| `numberedList` | Numbered list | Toggle line prefix `1. ` |
| `taskList` | Task list | Toggle line prefix `- [ ] ` |

Plugin additions:

| Plugin | ID | Trigger | Action |
|--------|-----|---------|--------|
| `@cartamd/plugin-attachment` | `attach` | Paperclip button | Opens native file picker (multi-file); same handler as drag-drop |
| `@cartamd/plugin-slash` | — | Type `/` at caret | Snippet menu: H1–H3, lists, quote, fenced code block |
| `@cartamd/plugin-emoji` | — | Type `:name:` | Emoji autocomplete picker |
| `@cartamd/plugin-code` | — | (no icon) | Shiki syntax highlighting in preview via rehype |

Icons overflow into a hamburger menu on narrow widths.

### Keyboard shortcuts (Carta defaults, Ctrl = Cmd on macOS)

| Shortcut | Action |
|----------|--------|
| Ctrl+B | Bold `**` |
| Ctrl+I | Italic `*` |
| Ctrl+E | Inline code `` ` `` |
| Ctrl+K | Link `[text](url)` |
| Ctrl+Shift+, | Blockquote `>` |
| Ctrl+Shift+X | Strikethrough `~~` |
| Ctrl+Z | Undo |
| Ctrl+Y | Redo |

## Image & file upload

Wire `@cartamd/plugin-attachment` with a custom `upload` callback:

```ts
attachment({
  supportedMimeTypes: [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/svg+xml",
    "image/webp",
    "image/avif",
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "application/pdf",
  ],
  upload: async (file) => {
    const fd = new FormData()
    fd.append("file", file)
    const res = await fetch("/api/media/upload.json", { method: "POST", body: fd })
    const data = await res.json()
    if (!data.ok || !data.url) return null
    return data.url  // public CDN URL inserted into markdown
  },
})
```

Upload behaviors (attachment plugin):

- Drag files onto textarea
- Paste clipboard files
- Paperclip toolbar button
- Images → `![filename](url)` as block at line end
- Non-images → `[filename](url)` inline
- Show `[Uploading filename](loading)` placeholder during upload

### Upload API endpoint

Create `POST /api/media/upload.json`:

- Accept multipart `FormData` with field `file`
- Auth required (session/token)
- Max file size: 10 MB
- Store in S3-compatible storage (e.g. Cloudflare R2) or equivalent
- Return JSON: `{ ok: true, id, url, thumbnailUrl, previewUrl, filename, mime, width, height, size }`
- Generate WebP thumbnails (max 300px edge) for raster images via Sharp

In anh.pw the endpoint is `POST /api/dash/media/upload.json` (admin session required).

## Optional: Media library picker

If you have a media library UI, support picking assets into the editor via `postMessage`:

- Message type: `anh-pw:media-pick` (rename for your app)
- Payload: `{ type, url, filename, mime, id?, thumbnailUrl? }`
- Editor listens on `window.onmessage`, validates origin, appends:
  - Images: `![filename](url)`
  - Other: `[filename](url)`
- Use an "arming" pattern so cover/gallery pickers don't also insert into body editor

Picker popup: `window.open("/dash/media?pick=1", ...)` before opening library.

On pick: post message to `window.opener` and close popup.

## Scroll behavior fix

Carta's textarea uses `overflow:hidden` and can trap wheel events. Add a wheel handler on the editor wrapper:

- Scroll the visible `.carta-input` or `.carta-renderer` pane first
- At scroll edges, chain to `window.scrollBy` so the page scrolls

## Styling

Theme: `theme="github"` → target `.carta-theme__github`

Map site CSS variables onto Carta theme variables:

```css
--carta-bg: var(--color-surface);
--carta-bg-toolbar: color-mix(in srgb, var(--color-secondary) 8%, var(--color-surface));
--carta-border: var(--color-border);
--carta-accent: var(--color-tertiary);
--carta-text: var(--color-primary);
--carta-muted: var(--color-secondary);
--selection-color: color-mix(in srgb, var(--color-tertiary) 28%, transparent);
--hover-color: color-mix(in srgb, var(--color-secondary) 12%, transparent);
```

Also:

- Reset global button styles inside editor chrome (site button CSS breaks Carta icon buttons)
- Style Write/Preview tab chrome, active tab borders, focus rings
- Style slash/emoji dropdown portals with site tokens + card shadow
- Restore list markers (Tailwind preflight may strip them)
- Support dark mode for Shiki code blocks (`html[data-theme="dark"]`, `html.dark`)
- Set editor min-height via CSS variable `--editor-min-height` from `minHeight` prop
- Preview pane: `max-height: min(36rem, calc(100dvh - 14rem))` with `overflow: auto`

Use scoped Svelte `<style>` with `:global()` for Carta class overrides — not Tailwind on Carta internals.

## Public rendering (separate from editor)

Store plain markdown strings in the database. For public pages, render with a separate pipeline (not Carta):

- `marked` (GFM) + `shiki` for code highlighting
- Wrap output in `.prose` class
- Mirror editor preview rhythm (line-height 1.75, heading margins, blockquote, lists)

anh.pw reference: `apps/site/src/lib/renderMarkdown.ts`

## Usage examples

```svelte
<!-- Basic -->
<MarkdownEditor name="body" bind:value={body} label="Body" required />

<!-- Comment form (no media picker, attachments only for admins) -->
<MarkdownEditor
  name="body"
  bind:value={body}
  minHeight="140px"
  listenForMediaPick={false}
  enableAttachment={isAdmin}
/>

<!-- Gallery caption (no inline attachments, no media pick) -->
<MarkdownEditor
  name="caption"
  bind:value={caption}
  minHeight="160px"
  listenForMediaPick={false}
  enableAttachment={false}
/>
```

## Deliverables

1. `MarkdownEditor.svelte` — full wrapper component with styling
2. `POST /api/media/upload.json` — upload endpoint + storage helper
3. (Optional) Media picker postMessage protocol
4. (Optional) `renderMarkdown.ts` for server-side public rendering

Match anh.pw behavior: markdown-only (no rich-text/ProseMirror), Write/Preview tabs, full toolbar, image upload via drag/paste/paperclip, slash commands, emoji picker, code highlighting in preview, DOMPurify sanitization, hidden input for form compatibility.
```

---

## Architecture Overview

### Format

**Markdown only.** No ProseMirror, TipTap, or rich-text document model. All formatting is markdown syntax in a textarea with live HTML preview.

| Layer | Technology | anh.pw path |
|-------|------------|-------------|
| Storage | Plain `text` in Postgres | `packages/db/src/schema.ts` |
| Dash editor | Carta textarea + live preview | `apps/site/src/components/MarkdownEditor.svelte` |
| Preview sanitization | DOMPurify | `MarkdownEditor.svelte` |
| Public rendering | `marked` (GFM) + Shiki | `apps/site/src/lib/renderMarkdown.ts` |
| Public HTML wrapper | `.prose` class | `apps/site/src/styles/global.css` |

### Primary component

| Path | Component | Role |
|------|-----------|------|
| `apps/site/src/components/MarkdownEditor.svelte` | `MarkdownEditor` | Carta-backed composer for all dash/public forms |

### Consumers

| Path | Component | Editor usage |
|------|-----------|--------------|
| `apps/site/src/components/PostComposer.svelte` | `PostComposer` | Main post create/edit form |
| `apps/site/src/components/PageLocaleEditor.svelte` | `PageLocaleEditor` | Multi-locale static pages |
| `apps/site/src/components/CommentSection.svelte` | `CommentSection` | Public comment form |

### Dash pages

| Path | Mounts |
|------|--------|
| `apps/site/src/pages/dash/posts/new.astro` | `PostComposer` |
| `apps/site/src/pages/dash/posts/[id]/edit.astro` | `PostComposer` |
| `apps/site/src/pages/dash/pages/[key]/edit.astro` | `PageLocaleEditor` |

### Related media UI

| Path | Component |
|------|-----------|
| `apps/site/src/components/CoverImageField.svelte` | Cover image picker/upload |
| `apps/site/src/components/ImageGalleryField.svelte` | Gallery for `image` content type |
| `apps/site/src/components/MediaLibrary.svelte` | Full media library + pick mode popup |
| `apps/site/src/pages/dash/media/index.astro` | Media library page (`?pick=1` for popup picker) |

---

## Dependencies

From `apps/site/package.json`:

| Package | Version | Role |
|---------|---------|------|
| `carta-md` | ^4.11.2 | Svelte 5 markdown editor + preview |
| `@cartamd/plugin-attachment` | ^4.2.0 | Upload, drag-drop, paste, paperclip |
| `@cartamd/plugin-code` | ^4.2.0 | Shiki rehype highlighting in preview |
| `@cartamd/plugin-emoji` | ^4.3.0 | `:emoji:` autocomplete + remark-emoji |
| `@cartamd/plugin-slash` | ^4.2.0 | `/` slash commands |
| `isomorphic-dompurify` | ^3.22.0 | Preview HTML sanitization |
| `marked` | ^15.0.12 | Server-side public markdown render |
| `shiki` | ^3.23.0 | Code highlighting (public + Carta preview) |
| `sharp` | ^0.35.3 | Image thumbnails on upload |
| `aws4fetch` | ^1.0.20 | R2 uploads |
| `svelte` | ^5.56.2 | Component framework |

Carta internally uses: `unified`, `remark-gfm`, `remark-parse`, `remark-rehype`, `rehype-stringify`.

---

## Image Upload Details

### Upload API routes

| Route | File | Notes |
|-------|------|-------|
| `POST /api/dash/media/upload.json` | `apps/site/src/pages/api/dash/media/upload.json.ts` | Primary JSON upload |
| `POST /api/dash/media/upload` | `apps/site/src/pages/api/dash/media/upload.ts` | Form redirect upload |
| `GET/POST /api/agent/media` | `apps/site/src/pages/api/agent/media/index.ts` | Agent token auth |

### Storage backend

`apps/site/src/lib/media/storage.ts`:

- **Cloudflare R2** via `aws4fetch` (S3-compatible API)
- Env: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `CDN_BASE_URL`
- Object key: `media/{uuid}-{sanitized_filename}`
- Public URL: `{CDN_BASE_URL}/{encoded_key}`
- Max size: 10 MB
- DB table: `media_assets` (`packages/db/src/schema.ts`)
- Thumbnails: `apps/site/src/lib/media/thumbnails.ts` — Sharp WebP at max 300px edge (not SVG)

### Media picker protocol

`apps/site/src/lib/media/picker.ts`:

```ts
export const MEDIA_PICK_MESSAGE = "anh-pw:media-pick"

export type MediaPickPayload = {
  type: typeof MEDIA_PICK_MESSAGE
  url: string
  filename: string
  mime: string
  id?: string
  thumbnailUrl?: string | null
}

export function markdownForMedia(filename: string, url: string, mime: string): string {
  if (mime.startsWith("image/")) return `![${filename}](${url})`
  return `[${filename}](${url})`
}
```

Arming pattern:

- `armMediaPicker(pickerId)` before opening popup
- `hasArmedMediaPicker()` — editor skips insert when cover/gallery claimed the pick
- `disarmMediaPicker(pickerId)` after handling

### Gallery vs body images

- **Gallery posts** (`type === "image"`): images in `ImageGalleryField` → `media_ids` hidden inputs; `listenForMediaPick={false}` on body editor
- **Inline images**: pasted/uploaded into markdown body as CDN URLs

---

## Utilities & API Routes

### Utilities

| Path | Purpose |
|------|---------|
| `apps/site/src/lib/media/picker.ts` | Media pick postMessage protocol, arming, markdown insertion |
| `apps/site/src/lib/media/storage.ts` | R2 upload, listing, deletion, `saveUpload` |
| `apps/site/src/lib/media/thumbnails.ts` | Sharp processing, `previewUrl` helper |
| `apps/site/src/lib/renderMarkdown.ts` | Server markdown → HTML |
| `apps/site/src/lib/contentDisplay.ts` | Markdown image extraction, excerpts |
| `apps/site/src/lib/contentExcerpt.ts` | Strip markdown for previews |
| `apps/site/src/lib/contentTypes.ts` | Per-type body labels, placeholders, min heights |

### Stores

No dedicated editor Svelte stores. State is local `$state` / `bind:value` in parent components.

### Auth

`apps/site/src/middleware.ts` — all `/dash` and `/api/dash` paths require admin session with `dash:view` permission.

---

## UX Behaviors

### PostComposer editor variants

| Content type | Body label | Min height | Media pick | Required |
|--------------|------------|------------|------------|----------|
| post | Body | 280px | yes | no |
| article/code | Article body / Code | 360px | yes | yes |
| link/video | Note / Notes | 180px | yes | no |
| quote | Quote | 200px | yes | yes |
| image (gallery) | Caption | 160px | no | no |

### Comment editor

- `minHeight="140px"`, `listenForMediaPick={false}`
- `enableAttachment={Boolean(adminAuth)}` — only admins can attach files
- `inert` when submitting
- 2000 char counter in footer (client-side display only)
- Submit via `fetch` JSON, not form POST
- Comments stored as markdown but displayed as plain text (not rendered)

### PageLocaleEditor

- Locale tab switching with `beforeunload` guard when draft modified
- Hidden inputs for non-active locale fields on submit
- `minHeight="360px"` for body

### Progressive enhancement

Hidden input + native form POST supported; `PostComposer` intercepts submit with `fetch` + toast for JSON responses.

### Paste handling

- **Files on clipboard:** attachment plugin intercepts paste, uploads, inserts markdown
- **Text:** normal paste into textarea

### Drag-and-drop

- **Editor:** attachment plugin — drag files onto textarea
- **Gallery field:** drop zone on `ImageGalleryField`
- **Media library:** drop on grid

---

## Tips for Other Apps

1. **Same monorepo** — Copy and adapt `apps/site/src/components/MarkdownEditor.svelte` directly.

2. **Swap upload backend** — Replace R2/CDN with your storage (S3, local disk, UploadThing, etc.) but keep the same JSON response shape (`{ ok, url }`).

3. **Non-Svelte framework** — Same UX and features, different implementation stack. The feature list still applies; only the Carta stack is Svelte-specific.

4. **Minimal scope** — Drop media library picker, emoji, and slash plugins; keep tabs + toolbar + attachment upload.

5. **Rename message type** — Change `anh-pw:media-pick` to your app's namespace when porting the picker protocol.

<script lang="ts">
	import { parseFrame, SessionAssembler } from "../../src/qr/protocol"
	import { coverOrigin } from "./lib/scan-geometry"
	import {
		scanImageFile,
		startCamera,
		startScanner,
		type ScanBox,
		type ScanEngines,
		type ScanHandle,
	} from "./lib/scanner"

	const version = __TC_VERSION__
	const gitSha = __TC_GIT_SHA__ || "unknown"
	const gitBranch = __TC_GIT_BRANCH__ || "unknown"
	const gitDirty = __TC_GIT_DIRTY__
	const commitLabel = gitDirty ? `${gitSha}*` : gitSha

	type Phase = "idle" | "live" | "complete"

	let phase = $state<Phase>("idle")
	let error = $state("")
	let videoEl = $state<HTMLVideoElement | null>(null)
	let assembler = new SessionAssembler()
	let received = $state(0)
	let needed = $state(0)
	let filled = $state<boolean[]>([])
	let name = $state("")
	let sessionId = $state("")
	let kind = $state("")
	let sha = $state("")
	let payload = $state<string | null>(null)
	let copied = $state(false)
	let scan: ScanHandle | null = null
	let stream: MediaStream | null = null
	let completing = false
	let lockBox = $state.raw<ScanBox | null>(null)
	let finderW = $state(0)
	let finderH = $state(0)
	let videoW = $state(0)
	let videoH = $state(0)
	let engines = $state.raw<ScanEngines | null>(null)

	let zxingLabel = $derived(
		engines === null
			? "starting"
			: engines.zxing
				? "ready"
				: engines.settled
					? "unavailable"
					: "loading",
	)
	let detectorLabel = $derived(
		engines === null ? "starting" : engines.barcodeDetector ? "yes" : "no",
	)
	let workerLabel = $derived(
		engines === null ? "starting" : engines.worker ? "web worker" : "failed",
	)

	let view = $derived.by(() =>
		coverOrigin(lockBox, videoW, videoH, finderW, finderH, phase === "live"),
	)

	let progressLabel = $derived(
		needed === 0 ? "Waiting for a header frame" : `${received} of ${needed} chunks`,
	)
	let percent = $derived(needed === 0 ? 0 : Math.round((received / needed) * 100))

	function onScan(text: string) {
		if (parseFrame(text) === null) return
		assembler.addText(text)
		syncFromAssembler()
		if (assembler.hasAllChunks && !completing && payload === null) {
			completing = true
			void assembler.maybeComplete().then((value) => {
				if (value !== null) {
					payload = value
					phase = "complete"
					lockBox = null
					scan?.stop()
					scan = null
					stopStream()
				}
				completing = false
			})
		}
	}

	function syncFromAssembler() {
		received = assembler.received
		needed = assembler.needed
		const header = assembler.header
		if (!header) return
		name = header.name
		sessionId = header.sessionId
		kind = header.kind
		sha = header.sha256
		if (filled.length !== header.chunkCount) {
			filled = Array.from({ length: header.chunkCount }, () => false)
		}
		const next = filled.slice()
		let changed = false
		for (const index of assembler.chunks.keys()) {
			if (!next[index]) {
				next[index] = true
				changed = true
			}
		}
		if (changed) filled = next
	}

	async function beginLive() {
		error = ""
		if (!window.isSecureContext) {
			error =
				"Camera needs a secure origin. Open the HTTPS address Vite printed, or use localhost."
			return
		}
		if (!navigator.mediaDevices?.getUserMedia) {
			error = "This browser cannot open a camera. Use a photo of the QR instead."
			return
		}
		resetAssembler()
		lockBox = null
		phase = "live"
		try {
			const media = await startCamera()
			stream = media
			const el = videoEl
			if (!el) {
				throw new Error("Camera view is not ready.")
			}
			el.srcObject = media
			await el.play()
			scan = await startScanner(
				el,
				(hit) => {
					onScan(hit.text)
				},
				(box) => {
					lockBox = box
				},
				(next) => {
					engines = next
				},
			)
		} catch (err) {
			error = cameraErrorMessage(err)
			stopLive()
			phase = "idle"
		}
	}

	function resetAssembler() {
		assembler.reset()
		received = 0
		needed = 0
		filled = []
		name = ""
		sessionId = ""
		kind = ""
		sha = ""
		payload = null
		copied = false
		completing = false
	}

	function stopStream() {
		if (!stream) return
		for (const track of stream.getTracks()) track.stop()
		stream = null
		if (videoEl) videoEl.srcObject = null
	}

	function stopLive() {
		scan?.stop()
		scan = null
		stopStream()
		lockBox = null
		phase = payload ? "complete" : "idle"
	}

	async function onPhoto(event: Event) {
		const input = event.currentTarget as HTMLInputElement
		const file = input.files?.[0]
		input.value = ""
		if (!file) return
		error = ""
		const texts = await scanImageFile(file)
		if (texts.length === 0) {
			error = "No QR code in that image. Fill the frame with the terminal QR grid and try again."
			return
		}
		for (const text of texts) onScan(text)
	}

	async function copyPayload() {
		if (!payload) return
		await navigator.clipboard.writeText(payload)
		copied = true
	}

	function downloadPayload() {
		if (!payload) return
		const blob = new Blob([payload], { type: "text/plain;charset=utf-8" })
		const url = URL.createObjectURL(blob)
		const link = document.createElement("a")
		link.href = url
		link.download = name || "payload.txt"
		link.click()
		URL.revokeObjectURL(url)
	}

	function startOver() {
		stopStream()
		scan?.stop()
		scan = null
		resetAssembler()
		lockBox = null
		phase = "idle"
		error = ""
	}

	function cameraErrorMessage(err: unknown): string {
		const code = err instanceof DOMException ? err.name : ""
		if (code === "NotAllowedError") {
			return "Camera permission was denied. Allow it in the browser, or use a photo."
		}
		if (code === "NotFoundError") {
			return "No camera found on this device. Use a photo of the QR instead."
		}
		return err instanceof Error ? err.message : "Could not open the camera."
	}

	function attachCamera(node: HTMLVideoElement) {
		videoEl = node
		return () => {
			if (videoEl === node) videoEl = null
		}
	}
</script>

<svelte:head>
	<title>text-compress receiver v{version} · {commitLabel}</title>
</svelte:head>

<div class="stage">
	<main>
		<header class="hud">
			<p class="eyebrow">text-compress receiver</p>
			<h1>Optical receive</h1>
			<p class="lede">
				Point this camera at the 2×2 QR grid in the terminal. The viewfinder locks onto the
				whole card. Missed frames are fine — it loops until every chunk lands.
			</p>
		</header>

		<aside class="build" aria-label="Receiver build">
			<p class="build-id">v{version}</p>
			<dl>
				<div>
					<dt>Commit</dt>
					<dd>
						<code>{commitLabel}</code>
						<span>{gitBranch}</span>
						{#if gitDirty}<span>local changes</span>{/if}
					</dd>
				</div>
				<div>
					<dt>Protocol</dt>
					<dd>TCQR v1</dd>
				</div>
				<div>
					<dt>Decode</dt>
					<dd>web worker · zxing-wasm · BarcodeDetector · jsQR</dd>
				</div>
				{#if engines}
					<div>
						<dt>Engines</dt>
						<dd>
							<span class={["flag", { on: engines.worker }]}>{workerLabel}</span>
							<span class={["flag", { on: engines.zxing }]}>zxing-wasm {zxingLabel}</span>
							<span class={["flag", { on: engines.barcodeDetector }]}
								>BarcodeDetector {detectorLabel}</span
							>
							<span class="flag on">jsQR fallback</span>
						</dd>
					</div>
				{/if}
			</dl>
		</aside>

		<section
			class="viewfinder"
			aria-label="Camera viewfinder"
			bind:clientWidth={finderW}
			bind:clientHeight={finderH}
			style:--zoom={view.zoom}
			style:--ox="{view.ox}%"
			style:--oy="{view.oy}%"
		>
			<video
				{@attach attachCamera}
				bind:videoWidth={videoW}
				bind:videoHeight={videoH}
				class={["camera", { off: phase !== "live" }]}
				autoplay
				playsinline
				muted
				aria-hidden={phase !== "live"}
				aria-label="Live camera"
			></video>
			{#if phase !== "live"}
				<div class="standby"></div>
			{/if}

			<div class="reticle" aria-hidden="true">
				<span class="corner tl"></span>
				<span class="corner tr"></span>
				<span class="corner bl"></span>
				<span class="corner br"></span>
			</div>

			<div class={["mosaic", { empty: filled.length === 0 }]} role="img" aria-label={progressLabel}>
				{#each filled as cell, index (index)}
					<span class={["cell", { on: cell }]}></span>
				{/each}
			</div>
		</section>

		<p class="status" role="status">{progressLabel}{needed ? ` · ${percent}%` : ""}</p>
		{#if sessionId}
			<p class="meta">
				<span>{name}</span>
				<span>{sessionId}</span>
				{#if kind}<span>{kind}</span>{/if}
			</p>
		{/if}

		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}

		{#if phase === "complete" && payload}
			<section class="sheet" aria-labelledby="done-title">
				<h2 id="done-title">Hash matches</h2>
				<p>
					{name} · {payload.length.toLocaleString("en-US")} chars · sha {sha.slice(0, 16)}
				</p>
				<div class="actions">
					<button type="button" class="primary" onclick={downloadPayload}>Save file</button>
					<button type="button" onclick={copyPayload}>{copied ? "Copied" : "Copy payload"}</button>
					<button type="button" class="ghost" onclick={startOver}>Receive another</button>
				</div>
			</section>
		{:else}
			<div class="actions">
				{#if phase !== "live"}
					<button type="button" class="primary" onclick={beginLive}>Allow camera</button>
				{:else}
					<button type="button" onclick={stopLive}>Stop camera</button>
				{/if}
				<label class="file">
					<input type="file" accept="image/*" onchange={onPhoto} />
					Use a photo
				</label>
			</div>
		{/if}
	</main>
</div>

<style>
	.stage {
		min-height: 100%;
		padding: 1.25rem 1.25rem var(--pad);
		display: grid;
		place-items: start center;
	}

	main {
		width: min(40rem, 100%);
		display: grid;
		gap: 1rem;
	}

	.hud {
		display: grid;
		gap: 0.35rem;
	}

	.eyebrow {
		margin: 0;
		color: var(--filament);
		font-size: 0.72rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}

	h1 {
		margin: 0;
		font-family: var(--sans);
		font-size: 1.85rem;
		font-weight: 600;
		letter-spacing: -0.03em;
		color: var(--paper);
	}

	.lede {
		margin: 0;
		max-width: 36ch;
		color: var(--muted);
		font-size: 0.9rem;
	}

	.build {
		display: grid;
		gap: 0.55rem;
		padding: 0.85rem 1rem 0.95rem;
		border-radius: 0.9rem;
		background: oklch(0.16 0.03 250 / 0.92);
		box-shadow: 0 0 0 1px oklch(1 0 0 / 0.08);
	}

	.build-id {
		margin: 0;
		color: var(--filament);
		font-size: 1.05rem;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.04em;
	}

	.build dl {
		display: grid;
		gap: 0.45rem;
		margin: 0;
	}

	.build dl > div {
		display: grid;
		grid-template-columns: 6.75rem minmax(0, 1fr);
		gap: 0.65rem 0.85rem;
		align-items: baseline;
	}

	.build dt {
		color: var(--muted);
		font-size: 0.72rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.build dd {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 0.7rem;
		margin: 0;
		color: var(--paper);
		font-size: 0.82rem;
	}

	.build code {
		font: inherit;
		font-variant-numeric: tabular-nums;
	}

	.flag {
		color: var(--muted);
	}

	.flag.on {
		color: var(--ok);
	}

	.viewfinder {
		--zoom: 1;
		--ox: 50%;
		--oy: 50%;
		position: relative;
		overflow: hidden;
		border-radius: 1.15rem;
		aspect-ratio: 3 / 4;
		background: var(--void-deep);
		box-shadow:
			0 0 0 1px oklch(1 0 0 / 0.08),
			0 24px 48px oklch(0 0 0 / 0.35);
	}

	video,
	.standby {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.camera {
		transform: scale(var(--zoom));
		transform-origin: var(--ox) var(--oy);
		transition: transform 0.28s cubic-bezier(0.2, 0, 0, 1);
	}

	.camera:not(.off) {
		will-change: transform;
	}

	.camera.off {
		opacity: 0;
		pointer-events: none;
	}

	.standby {
		background:
			radial-gradient(ellipse at 50% 35%, oklch(0.28 0.05 250 / 0.55), transparent 55%),
			repeating-linear-gradient(
				-12deg,
				transparent,
				transparent 11px,
				oklch(1 0 0 / 0.015) 11px,
				oklch(1 0 0 / 0.015) 12px
			);
	}

	.reticle {
		position: absolute;
		inset: 12% 14%;
		pointer-events: none;
	}

	.corner {
		position: absolute;
		width: 1.6rem;
		height: 1.6rem;
		border: 2px solid var(--filament);
	}

	.tl {
		top: 0;
		left: 0;
		border-right: 0;
		border-bottom: 0;
	}
	.tr {
		top: 0;
		right: 0;
		border-left: 0;
		border-bottom: 0;
	}
	.bl {
		bottom: 0;
		left: 0;
		border-right: 0;
		border-top: 0;
	}
	.br {
		bottom: 0;
		right: 0;
		border-left: 0;
		border-top: 0;
	}

	.mosaic {
		position: absolute;
		left: 0.85rem;
		right: 0.85rem;
		bottom: 0.85rem;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(0.45rem, 1fr));
		gap: 0.18rem;
		padding: 0.55rem;
		border-radius: 0.55rem;
		background: var(--glass);
		backdrop-filter: blur(10px);
	}

	.cell {
		aspect-ratio: 1;
		border-radius: 1px;
		background: var(--scan-dim);
	}

	.cell.on {
		background: var(--scan);
	}

	.mosaic.empty {
		grid-template-columns: 1fr;
		min-height: 0.55rem;
		background: oklch(1 0 0 / 0.07);
	}

	.status {
		margin: 0;
		color: var(--paper);
		font-variant-numeric: tabular-nums;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1.1rem;
		margin: 0;
		color: var(--muted);
		font-size: 0.78rem;
	}

	.error {
		margin: 0;
		color: var(--danger);
	}

	.sheet {
		display: grid;
		gap: 0.65rem;
		padding: 1rem 1.05rem 1.1rem;
		border-radius: 0.9rem;
		background: oklch(0.2 0.03 250 / 0.92);
		box-shadow: 0 0 0 1px oklch(1 0 0 / 0.08);
	}

	h2 {
		margin: 0;
		font-family: var(--sans);
		font-size: 1.15rem;
		color: var(--ok);
	}

	.sheet p {
		margin: 0;
		color: var(--muted);
		font-size: 0.85rem;
		overflow-wrap: anywhere;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
		align-items: center;
	}

	button,
	.file {
		position: relative;
		min-height: 2.75rem;
		padding: 0.55rem 1rem;
		border: 0;
		border-radius: 999px;
		background: oklch(0.24 0.03 250);
		color: var(--paper);
		cursor: pointer;
	}

	button:active,
	.file:active {
		scale: 0.96;
	}

	button.primary {
		background: var(--filament);
		color: var(--void-deep);
		font-weight: 600;
	}

	button.ghost {
		background: transparent;
		box-shadow: inset 0 0 0 1px oklch(1 0 0 / 0.18);
	}

	.file {
		display: inline-grid;
		place-items: center;
	}

	.file input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}

	@media (min-width: 720px) {
		.viewfinder {
			aspect-ratio: 4 / 3;
		}
	}
</style>

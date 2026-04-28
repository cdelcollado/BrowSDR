import { defineConfig, build, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import fs from 'fs';

// Workers that need explicit bundling after the main build:
// - dsp-worker: spawned from inside another worker; Vite can't handle worker-in-worker automatically
// - whisper-worker: loaded via plain URL, not Vite's worker import syntax
const EXTRA_WORKERS: Array<{
	entry: string;
	outDir: string;
	fileName: string;
	external: (RegExp | string)[];
}> = [
	{
		entry: 'src/client/dsp-worker.ts',
		outDir: 'dist/assets',
		fileName: 'dsp-worker.js',
		external: [/\/hackrf-web\/pkg\//],
	},
	{
		entry: 'src/client/whisper-worker.ts',
		outDir: 'dist',
		fileName: 'whisper-worker.js',
		external: [/^https?:\/\//],
	},
];

function postBuildPlugin(): Plugin {
	return {
		name: 'post-build',
		async closeBundle() {
			const distDir = path.resolve(__dirname, 'dist');
			const assetsDir = path.join(distDir, 'assets');

			// Bundle workers that Vite cannot handle automatically
			for (const worker of EXTRA_WORKERS) {
				const entry = path.resolve(__dirname, worker.entry);
				if (!fs.existsSync(entry)) continue;
				console.log(`[post-build] Bundling ${worker.fileName}`);
				await build({
					configFile: false,
					root: path.resolve(__dirname, 'src/client'),
					build: {
						outDir: path.resolve(__dirname, worker.outDir),
						emptyOutDir: false,
						lib: {
							entry,
							formats: ['es'],
							fileName: () => worker.fileName,
						},
						rollupOptions: { external: worker.external },
						minify: true,
					},
					resolve: {
						alias: { '/hackrf-web/pkg': path.resolve(__dirname, 'hackrf-web/pkg') },
					},
					logLevel: 'warn',
				});
			}

			// Vite sometimes emits worker files with their original .ts extension.
			// Rename them and fix all references so the browser can load them.
			const renames = new Map<string, string>();
			for (const file of fs.readdirSync(assetsDir)) {
				if (!file.endsWith('.ts')) continue;
				const jsName = file.replace(/\.ts$/, '.js');
				renames.set(file, jsName);
				fs.renameSync(path.join(assetsDir, file), path.join(assetsDir, jsName));
			}

			if (renames.size > 0) {
				for (const file of fs.readdirSync(assetsDir)) {
					if (!file.endsWith('.js')) continue;
					const filePath = path.join(assetsDir, file);
					let content = fs.readFileSync(filePath, 'utf-8');
					let changed = false;
					for (const [oldName, newName] of renames) {
						if (content.includes(oldName)) {
							content = content.replaceAll(oldName, newName);
							changed = true;
						}
					}
					if (changed) fs.writeFileSync(filePath, content);
				}

				const htmlPath = path.join(distDir, 'index.html');
				if (fs.existsSync(htmlPath)) {
					let html = fs.readFileSync(htmlPath, 'utf-8');
					let changed = false;
					for (const [oldName, newName] of renames) {
						if (html.includes(oldName)) {
							html = html.replaceAll(oldName, newName);
							changed = true;
						}
					}
					if (changed) fs.writeFileSync(htmlPath, html);
				}
			}

			// Copy WASM files
			const wasmSrc = path.resolve(__dirname, 'hackrf-web/pkg');
			const wasmDest = path.resolve(distDir, 'hackrf-web/pkg');
			if (fs.existsSync(wasmSrc)) {
				fs.mkdirSync(wasmDest, { recursive: true });
				for (const file of fs.readdirSync(wasmSrc)) {
					fs.copyFileSync(path.join(wasmSrc, file), path.join(wasmDest, file));
				}
			}
		},
	};
}

export default defineConfig({
	root: 'src/client',
	build: {
		outDir: path.resolve(__dirname, 'dist'),
		emptyOutDir: true,
		rollupOptions: {
			external: [
				/\/hackrf-web\/pkg\//,
			],
		},
	},
	worker: {
		format: 'es',
		rollupOptions: {
			external: [
				/\/hackrf-web\/pkg\//,
			],
		},
	},
	plugins: [
		VitePWA({
			registerType: 'autoUpdate',
			injectRegister: 'script',
			workbox: {
				skipWaiting: true,
				clientsClaim: true,
				globPatterns: ['**/*.{js,css,html,wasm}'],
				navigateFallback: null,
				runtimeCaching: [
					{
						// Geo lookup: country code rarely changes — serve stale, revalidate in background
						urlPattern: /\/api\/geo$/i,
						handler: 'StaleWhileRevalidate',
						options: {
							cacheName: 'geo-cache',
							expiration: { maxEntries: 5, maxAgeSeconds: 24 * 60 * 60 },
						},
					},
					{
						// TURN credentials expire server-side; a cached response would break WebRTC
						urlPattern: /\/api\/turn$/i,
						handler: 'NetworkOnly',
					},
				],
			},
			manifest: {
				name: 'BrowSDR – Web SDR Receiver',
				short_name: 'BrowSDR',
				description: 'A blazing-fast browser-based Software Defined Radio receiver.',
				theme_color: '#0f0f1a',
				background_color: '#0f0f1a',
				display: 'standalone',
				start_url: '/',
				icons: [
					{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
					{ src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
				],
			},
		}),
		postBuildPlugin(),
	],
	publicDir: path.resolve(__dirname, 'public'),
	define: {
		__VUE_OPTIONS_API__: true,
		__VUE_PROD_DEVTOOLS__: false,
		__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
	},
	resolve: {
		alias: {
			'vue': 'vue/dist/vue.esm-bundler.js',
			'/hackrf-web/pkg': path.resolve(__dirname, 'hackrf-web/pkg'),
		},
	},
	server: {
		proxy: {
			'/api': 'http://localhost:8787',
			'/hf-proxy': 'http://localhost:8787',
		},
	},
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@friday": resolve(import.meta.dirname, "../src"),
		},
	},
	server: {
		proxy: {
			"/ws": {
				target: "ws://localhost:3000",
				ws: true,
			},
		},
	},
});

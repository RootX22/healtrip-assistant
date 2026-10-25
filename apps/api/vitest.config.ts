import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// SWC rather than esbuild: Nest resolves constructor dependencies from the
// design:paramtypes metadata that only an emitDecoratorMetadata transform writes.
export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    include: ["src/**/*.spec.ts", "test/**/*.spec.ts"],
    environment: "node",
    setupFiles: ["test/setup.ts"],
    restoreMocks: true,
  },
});

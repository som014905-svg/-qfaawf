declare module "wasmoon" {
  export class LuaFactory {
    createEngine(): Promise<any>;
  }
}

// Optional peer of the dynamic Luraph VM decoder (see src/vm/luau-sandbox.ts).
// We deep-import the Asyncify build directly — the package entry point picks
// the JSPI backend on runtimes that expose WebAssembly.Suspending, which is
// broken under Bun (pcall errors escape the sandbox).
declare module "luau-web/src/lib/Luau.Web.Asyncify.js" {
  const factory: (config: unknown) => Promise<unknown>;
  export default factory;
}

declare module "luau-web" {
  export class LuauState {
    static createAsync(initialEnv?: Record<string, unknown>): Promise<any>;
    loadstring(source: string, chunkname?: string, throwOnCompilationError?: boolean): any;
    destroy(): void;
    env: any;
  }
  export const InternalLuauWasmModule: any;
}

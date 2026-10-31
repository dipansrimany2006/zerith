declare module 'snarkjs' {
  /** A file path or URL, or bytes already in memory. */
  export type ProvingFile = string | { type: 'mem'; data: Uint8Array }

  export interface PlonkProof {
    protocol: string
    curve: string
    [key: string]: unknown
  }

  export interface FullProveResult {
    proof: PlonkProof
    publicSignals: string[]
  }

  export const plonk: {
    fullProve(input: Record<string, unknown>, wasmFile: ProvingFile, zkeyFile: ProvingFile): Promise<FullProveResult>
    verify(vk: unknown, publicSignals: string[], proof: PlonkProof): Promise<boolean>
    /** Returns `[24 proof words],[5 public signals]` as hex strings, in the verifier's order. */
    exportSolidityCallData(proof: PlonkProof, publicSignals: string[]): Promise<string>
  }
}

declare module 'snarkjs' {
  export interface Groth16Proof {
    pi_a: string[]
    pi_b: string[][]
    pi_c: string[]
    protocol: string
    curve: string
  }

  export interface FullProveResult {
    proof: Groth16Proof
    publicSignals: string[]
  }

  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasmFile: string,
      zkeyFile: string,
    ): Promise<FullProveResult>
    verify(vk: unknown, publicSignals: string[], proof: Groth16Proof): Promise<boolean>
  }
}

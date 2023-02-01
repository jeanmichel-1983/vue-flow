const productionEnvs = ['production', 'prod']

export class VueFlowError extends Error {
  constructor(scope: string, message: string) {
    super(`[Vue Flow]: ${scope} - ${message}`)
  }
}

export function warn(message: string, ...args: any[]) {
  if (!productionEnvs.includes(__ENV__ || '')) {
    console.warn(`[Vue Flow]: ${message}`, ...args)
  }
}

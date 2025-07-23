// @ts-nocheck
export default defineNuxtConfig({
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  nitro: {
    experimental: {
      wasm: true
    }
  }
})
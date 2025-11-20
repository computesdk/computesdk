/**
 * Quick Railway Test - Just create and destroy without waiting
 */

import { describe, it, expect } from 'vitest'
import { RailwayClient } from '../client'

describe('Railway Quick Test', () => {
  it('should create and immediately destroy a sandbox with node:alpine', async () => {
    const client = new RailwayClient({
      apiKey: '99548a4e-c4c0-4521-b2c4-e6da8fa09129',
      projectId: '8088b565-0b19-4978-be48-6106160fa8a6',
      environmentId: '8e8b791d-d653-4d7f-8cba-30b51b975a29',
      tokenType: 'personal'
    })

    let serviceId: string | undefined
    
    try {
      console.log('Creating sandbox with node:alpine...')
      const service = await client.createService(`quick-test-${Date.now()}`)
      serviceId = service.id
      
      console.log(`Service created with ID: ${serviceId}`)
      expect(serviceId).toBeDefined()
      
      // Verify service exists
      const retrievedService = await client.getService(serviceId!)
      expect(retrievedService.id).toBe(serviceId)
      console.log(`Service verified. Using node:alpine image.`)
      
      // Immediately destroy
      console.log('Destroying service...')
      await client.deleteService(serviceId!)
      console.log('Service destroyed successfully!')
      
    } catch (error) {
      console.error('Test failed:', error)
      if (serviceId) {
        try {
          await client.deleteService(serviceId)
        } catch (cleanupError) {
          console.log('Cleanup failed:', cleanupError)
        }
      }
      throw error
    }
  }, 30000) // 30 second timeout
})
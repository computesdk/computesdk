// @ts-ignore
import fetch from 'node-fetch'

export type RailwayTokenType = 'personal' | 'project' | 'team'

export interface RailwayProviderConfig {
  apiKey: string
  projectId: string
  environmentId?: string
  tokenType?: RailwayTokenType
}

export class RailwayClient {
  private apiKey: string
  private projectId: string
  private environmentId: string
  private tokenType: RailwayTokenType
  private baseUrl = 'https://backboard.railway.com/graphql/v2'
  
  // ComputeSDK Railway sandbox image - extends official computesdk/compute with HTTP API
  private readonly RAILWAY_SANDBOX_IMAGE = 'ghcr.io/computesdk/railway-sandbox:latest'
  
  constructor(config: RailwayProviderConfig) {
    this.apiKey = config.apiKey
    this.projectId = config.projectId
    this.environmentId = config.environmentId || 'production'
    this.tokenType = config.tokenType || this.detectTokenType(config.apiKey)
  }
  
  async createService(name: string, env: Record<string, string> = {}): Promise<any> {
    const mutation = `
      mutation ServiceCreate($input: ServiceCreateInput!) {
        serviceCreate(input: $input) {
          id
          name
        }
      }
    `
    
    const variables = {
      input: {
        name,
        projectId: this.projectId,
        source: {
          image: this.RAILWAY_SANDBOX_IMAGE
        },
        variables: Object.entries(env).map(([key, value]) => ({
          name: key,
          value
        }))
      }
    }
    
    const result = await this.graphqlRequest(mutation, variables)
    return result.serviceCreate
  }
  
  async deployService(serviceId: string): Promise<any> {
    const mutation = `
      mutation ServiceInstanceDeploy($serviceId: String!, $environmentId: String!) {
        serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId) {
          id
          status
        }
      }
    `
    
    const variables = {
      serviceId,
      environmentId: this.environmentId
    }
    
    const result = await this.graphqlRequest(mutation, variables)
    return result.serviceInstanceDeploy
  }
  
  async getService(serviceId: string): Promise<any> {
    const query = `
      query Service($id: String!) {
        service(id: $id) {
          id
          name
          serviceInstances {
            edges {
              node {
                id
                latestDeployment {
                  id
                  status
                  staticUrl
                }
              }
            }
          }
        }
      }
    `
    
    const result = await this.graphqlRequest(query, { id: serviceId })
    return result.service
  }
  
  async deleteService(serviceId: string): Promise<void> {
    const mutation = `
      mutation ServiceDelete($id: String!) {
        serviceDelete(id: $id)
      }
    `
    
    await this.graphqlRequest(mutation, { id: serviceId })
  }
  
  async listServices(): Promise<any[]> {
    const query = `
      query Project($id: String!) {
        project(id: $id) {
          services {
            edges {
              node {
                id
                name
                serviceInstances {
                  edges {
                    node {
                      latestDeployment {
                        status
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `
    
    const result = await this.graphqlRequest(query, { id: this.projectId })
    return result.project.services.edges.map((edge: any) => edge.node)
  }
  
  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    
    switch (this.tokenType) {
      case 'personal':
        headers['Authorization'] = `Bearer ${this.apiKey}`
        break
      case 'project':
        headers['Project-Access-Token'] = this.apiKey
        break
      case 'team':
        headers['Team-Access-Token'] = this.apiKey
        break
      default:
        // Default to Bearer for backward compatibility
        headers['Authorization'] = `Bearer ${this.apiKey}`
    }
    
    return headers
  }
  
  private detectTokenType(apiKey: string): RailwayTokenType {
    // Simple heuristic to detect token type based on format/length
    // This is a fallback - explicit tokenType should be preferred
    
    if (!apiKey || typeof apiKey !== 'string') {
      return 'personal' // Safe default
    }
    
    // Railway project tokens are typically UUIDs (36 chars with dashes)
    if (apiKey.length === 36 && apiKey.includes('-')) {
      return 'project'
    }
    
    // Default to personal token for other formats
    return 'personal'
  }

  private async graphqlRequest(query: string, variables: any): Promise<any> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ query, variables })
    })
    
    if (!response.ok) {
      throw new Error(`Railway API request failed: ${response.statusText}`)
    }
    
    const result = await response.json() as any
    
    if (result.errors) {
      throw new Error(`Railway GraphQL Error: ${JSON.stringify(result.errors)}`)
    }
    
    return result.data
  }
  
  getOfficialImage(): string {
    return this.RAILWAY_SANDBOX_IMAGE
  }
}
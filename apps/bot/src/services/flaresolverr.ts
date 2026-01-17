import type { AxiosInstance } from 'axios';
import axios from 'axios';

const DEFAULT_FLARESOLVERR_URL = 'http://localhost:8191/v1';
const REQUEST_TIMEOUT = 60000; // 60 seconds - FlareSolverr can take time to solve challenges

interface FlareSolverrRequest {
  cmd: 'request.get' | 'request.post';
  url: string;
  maxTimeout?: number;
  headers?: Record<string, string>;
  postData?: string;
}

interface FlareSolverrResponse {
  status: string;
  message: string;
  startTimestamp: number;
  endTimestamp: number;
  version: string;
  solution: {
    url: string;
    status: number;
    headers: Record<string, string>;
    response: string;
    cookies: Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
      expires: number;
      httpOnly: boolean;
      secure: boolean;
    }>;
    userAgent: string;
  };
}

class FlareSolverrService {
  private client: AxiosInstance;
  private baseUrl: string;
  private isAvailable: boolean = false;
  private lastCheck: number = 0;
  private checkInterval: number = 60000; // Check availability every minute

  constructor() {
    this.baseUrl = process.env.FLARESOLVERR_URL || DEFAULT_FLARESOLVERR_URL;
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: REQUEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Check if FlareSolverr service is available
   */
  async checkAvailability(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastCheck < this.checkInterval && this.lastCheck > 0) {
      return this.isAvailable;
    }

    try {
      // FlareSolverr health check - just try to connect
      const response = await axios.get(this.baseUrl.replace('/v1', ''), {
        timeout: 5000,
      });
      this.isAvailable = response.status === 200;
      this.lastCheck = now;

      if (this.isAvailable) {
        console.log('[FlareSolverr] Service is available');
      }
    } catch {
      this.isAvailable = false;
      this.lastCheck = now;
    }

    return this.isAvailable;
  }

  /**
   * Get if service is currently marked as available
   */
  get available(): boolean {
    return this.isAvailable;
  }

  /**
   * Make a GET request through FlareSolverr
   */
  async get<T = any>(url: string, headers?: Record<string, string>): Promise<T | null> {
    if (!await this.checkAvailability()) {
      return null;
    }

    try {
      const request: FlareSolverrRequest = {
        cmd: 'request.get',
        url,
        maxTimeout: 45000,
        headers,
      };

      const response = await this.client.post<FlareSolverrResponse>('', request);

      if (response.data.status !== 'ok') {
        console.error('[FlareSolverr] Request failed:', response.data.message);
        return null;
      }

      // Parse the response body as JSON
      try {
        return JSON.parse(response.data.solution.response) as T;
      } catch {
        // Return raw response if not JSON
        return response.data.solution.response as unknown as T;
      }
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        console.warn('[FlareSolverr] Service not running. Start with: docker run -p 8191:8191 ghcr.io/flaresolverr/flaresolverr:latest');
        this.isAvailable = false;
      } else {
        console.error('[FlareSolverr] Request error:', error.message);
      }
      return null;
    }
  }

  /**
   * Make a POST request through FlareSolverr
   */
  async post<T = any>(url: string, data: any, headers?: Record<string, string>): Promise<T | null> {
    if (!await this.checkAvailability()) {
      return null;
    }

    try {
      const request: FlareSolverrRequest = {
        cmd: 'request.post',
        url,
        maxTimeout: 45000,
        headers,
        postData: typeof data === 'string' ? data : JSON.stringify(data),
      };

      const response = await this.client.post<FlareSolverrResponse>('', request);

      if (response.data.status !== 'ok') {
        console.error('[FlareSolverr] Request failed:', response.data.message);
        return null;
      }

      try {
        return JSON.parse(response.data.solution.response) as T;
      } catch {
        return response.data.solution.response as unknown as T;
      }
    } catch (error: any) {
      console.error('[FlareSolverr] POST error:', error.message);
      return null;
    }
  }

  /**
   * Set custom FlareSolverr URL
   */
  setUrl(url: string): void {
    this.baseUrl = url;
    this.client = axios.create({
      baseURL: url,
      timeout: REQUEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    this.isAvailable = false;
    this.lastCheck = 0;
  }
}

export const flareSolverr = new FlareSolverrService();

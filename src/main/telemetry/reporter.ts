import { createHmac, randomUUID } from 'crypto'
import { app } from 'electron'
import type { TelemetryConfigManager } from './config'
import type { TelemetryEvent, TelemetryEventBatch, TelemetryEventInput } from './events'

// 与服务端 (spark-pai master) pai_config.TELEMETRY_HMAC_SECRET 一致
const HMAC_SECRET = 'harnessclaw-telemetry-2026-v1-shared-secret'

/**
 * Telemetry 上报器
 *
 * 职责:
 * 1. 检查隐私开关
 * 2. 补全事件字段 (event_id / device_id / timestamp / app_version 等)
 * 3. HMAC-SHA256 签名后发送到服务端 (fire-and-forget,失败静默,不重试)
 */
export class TelemetryReporter {
  private appVersion: string
  private platform: string
  private environment: string

  constructor(
    private deviceId: string,
    private clientSessionId: string,
    private configManager: TelemetryConfigManager,
    _harnessclawDir: string
  ) {
    this.appVersion = app.getVersion()
    this.platform = process.platform
    this.environment = process.env.NODE_ENV === 'development' ? 'development' : 'production'
  }

  /**
   * 上报单个事件 (异步,不阻塞调用方)
   */
  report(input: TelemetryEventInput): void {
    if (!this.configManager.shouldReport(input.category, input.action)) {
      return
    }
    const event = this.buildEvent(input)
    void this.send([event])
  }

  /**
   * 同步上报 (用于 app_exit 等需要等待发送完成的场景)
   */
  async reportSync(input: TelemetryEventInput, timeoutMs = 2000): Promise<void> {
    if (!this.configManager.shouldReport(input.category, input.action)) {
      return
    }
    const event = this.buildEvent(input)
    await this.send([event], timeoutMs)
  }

  /**
   * 构建事件对象
   */
  private buildEvent(input: TelemetryEventInput): TelemetryEvent {
    return {
      event_id: randomUUID(),
      device_id: this.deviceId,
      client_session_id: this.clientSessionId,
      timestamp: Date.now(),
      category: input.category,
      action: input.action,
      app_version: this.appVersion,
      platform: this.platform,
      environment: this.environment,
      properties: input.properties || {}
    }
  }

  private async send(events: TelemetryEvent[], timeoutMs = 5000): Promise<void> {
    const config = this.configManager.getConfig()
    const batch: TelemetryEventBatch = { schema_version: '1.0', events }
    const body = JSON.stringify(batch)

    // HMAC-SHA256 签名 — 必须与服务端 receiver.py 规则一致:
    //   signature = HMAC-SHA256(secret, f"{timestamp}.{body}")
    // 时间戳为毫秒,服务端窗口 ±5 分钟。签名和发送必须用同一份 body 字符串。
    const timestamp = Date.now().toString()
    const signature = createHmac('sha256', HMAC_SECRET)
      .update(`${timestamp}.${body}`)
      .digest('hex')

    try {
      const res = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telemetry-Timestamp': timestamp,
          'X-Telemetry-Signature': signature
        },
        body,
        signal: AbortSignal.timeout(timeoutMs)
      })

      if (!res.ok) {
        console.debug(
          `[Telemetry] Server returned ${res.status} for ${events[0]?.category}.${events[0]?.action}`
        )
      }
    } catch (err) {
      // 静默失败 — 埋点不能影响主流程
      if (err instanceof Error) {
        console.debug(`[Telemetry] Send failed (silent): ${err.message}`)
      }
    }
  }

  getDeviceId(): string {
    return this.deviceId
  }

  getClientSessionId(): string {
    return this.clientSessionId
  }
}

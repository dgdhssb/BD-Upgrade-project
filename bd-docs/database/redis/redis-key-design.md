\# Redis 数据结构设计



对应微服务：MS-03/04/08/20  

职责：实时状态缓存、会话管理、高并发锁



\---



\## 1. 实时定位缓存



| 项 | 说明 |

|---|---|

| 数据结构 | Hash |

| KEY 模式 | `station:status:{stationId}` |

| 操作示例 | `HSET BJFS longitude 116.23 latitude 39.78` |

| TTL | 60s |

| 用途 | 缓存台站实时定位坐标 |



\---



\## 2. SNR 实时趋势



| 项 | 说明 |

|---|---|

| 数据结构 | Sorted Set |

| KEY 模式 | `snr:trend:{stationId}:{sat}` |

| 操作示例 | `ZADD snr:trend:BJFS:G01 1721987654 42.5` |

| TTL | 5min |

| 用途 | 存储信噪比时序数据，用于质量分析 |



\---



\## 3. NTRIP 在线会话



| 项 | 说明 |

|---|---|

| 数据结构 | Set |

| KEY 模式 | `ntrip:clients:{mountpoint}` |

| 操作示例 | `SADD ntrip:clients:RTCM33 "sess\_123"` |

| TTL | 持续（会话断开时主动删除） |

| 用途 | 记录当前连接指定挂载点的客户端会话 |



\---



\## 4. 消息队列积压



| 项 | 说明 |

|---|---|

| 数据结构 | String |

| KEY 模式 | `mq:lag:{topic}:{group}` |

| 操作示例 | `SET mq:lag:raw-data:group1 1284` |

| TTL | 1min |

| 用途 | 监控消息队列消费积压量 |



\---



\## 5. JWT 黑名单



| 项 | 说明 |

|---|---|

| 数据结构 | String |

| KEY 模式 | `jwt:blacklist:{jti}` |

| 操作示例 | `SET jwt:blacklist:abc123 "1" EX 3600` |

| TTL | 动态（与 Token 剩余有效期一致） |

| 用途 | 注销 Token，实现登出和强制过期 |



\---



\## 6. 差分数据缓存



| 项 | 说明 |

|---|---|

| 数据结构 | String（Binary） |

| KEY 模式 | `diff:latest:{mountpoint}` |

| 操作示例 | `SET diff:latest:RTCM33 <base64\_data>` |

| TTL | 10s |

| 用途 | 缓存最新差分改正数据，供快速播发 |



\---



\## 部署说明



团队成员需在本地启动 Redis 服务（默认端口 6379），微服务通过 `spring.data.redis.host=localhost` 和 `spring.data.redis.port=6379` 连接。以上 Key 由各微服务在运行时动态创建，无需预先执行任何初始化脚本。


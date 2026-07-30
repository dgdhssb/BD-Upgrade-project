\# NoSQL 存储设计（待完善）



> 本文件为占位文档，详细内容将在 MS-12（元数据服务）和 MS-16（日志服务）开发阶段补充。



\## 1. Elasticsearch（检索层）



\### 1.1 元数据索引（对应 MS-12）

\- 索引名：`gnss\_metadata\_catalog`

\- 用途：支持按空间范围、时间、标签的秒级检索



\### 1.2 全链路日志索引（对应 MS-16）

\- 索引名：`gnss\_operation\_logs`

\- 用途：存储 TraceId 关联的微服务调用链路日志



\## 2. Redis（缓存层）



\### 2.1 会话与状态缓存

\- 定位解算实时坐标：`station:status:{stationId}`

\- SNR 趋势缓存：`snr:trend:{stationId}:{sat}`

\- NTRIP 在线会话：`ntrip:clients:{mountpoint}`

\- JWT 黑名单：`jwt:blacklist:{jti}`



\### 2.2 数据缓存

\- 差分数据实时缓存：`diff:latest:{mountpoint}`



> 上述 Key 命名与 TTL 策略将在对应服务实现时落地。

\---

\*\*补充说明\*\*：ES 和 Redis 的完整部署配置（含 docker-compose 示例）将在后续迭代中尽快随代码一并提交。


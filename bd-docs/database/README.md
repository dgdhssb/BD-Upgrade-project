\# 数据库交付说明



> 版本：v1.0  

> 更新日期：2026-08-02  

> 维护人：余伟祺



\---



\## 一、交付物清单



| 序号 | 文件/目录 | 说明 |

| :--- | :--- | :--- |

| 1 | `sql/init.sql` | PostgreSQL 全量建表脚本（7 Schema / 23 Tables） |

| 2 | `es/gnss\_metadata\_catalog.json` | Elasticsearch 元数据索引 Mapping |

| 3 | `es/gnss\_operation\_logs.json` | Elasticsearch 日志索引 Mapping |

| 4 | `redis/redis-key-design.md` | Redis 键名规范设计文档 |

| 5 | `README.md` | 本文档（交付说明） |



\---



\## 二、团队成员使用指南



\### 2.1 PostgreSQL（必需）



\*\*操作步骤：\*\*

1\. 确保本地已安装 PostgreSQL 16+ 并启动服务。

2\. 创建数据库（名称建议 `bd\_upgrade\_db`）：

&#x20;  ```sql

&#x20;  CREATE DATABASE bd\_upgrade\_db;

3\. 执行建表脚本

bash

&#x20;  psql -U postgres -d bd\_upgrade\_db -f bd-docs/database/sql/init.sql

4\.验证

sql

&#x20;  SELECT schemaname, tablename FROM pg\_tables 

&#x20;  WHERE schemaname IN ('auth\_svc','archive\_svc','lifecycle\_svc','log\_svc','mountpoint\_svc','monitor\_svc','metadata\_svc')

&#x20;  ORDER BY schemaname, tablename;

应返回 23 条记录。初始账号：

管理员：admin / 123456

测试用户：testuser / 123456



2.2 Elasticsearch（MS-12 / MS-16 ）

操作步骤：

确保本地已安装 Elasticsearch 8.x 并启动（默认端口 9200）。

创建元数据索引：

bash

curl -X PUT "http://localhost:9200/gnss\_metadata\_catalog" -H "Content-Type: application/json" -d "@bd-docs/database/es/gnss\_metadata\_catalog.json"

创建日志索引：

bash

curl -X PUT "http://localhost:9200/gnss\_operation\_logs" -H "Content-Type: application/json" -d "@bd-docs/database/es/gnss\_operation\_logs.json"

验证：

bash

curl -X GET "http://localhost:9200/\_cat/indices"

应看到 gnss\_metadata\_catalog 和 gnss\_operation\_logs 两个索引状态为 open。



2.3 Redis（MS-03 / MS-04 / MS-08 / MS-14 / MS-20 需要）

操作步骤：

确保本地已安装 Redis 7.x 并启动（默认端口 6379）。

无需执行任何“建表”或“初始化”命令。

微服务启动时会自动根据业务逻辑写入缓存数据。

详细 Key 设计请参考：bd-docs/database/redis/redis-key-design.md。

验证 Redis 是否可用：

bash

redis-cli ping

应返回 PONG。



2.4 对象存储（MS-10 归档服务需要）

归档文件的物理存储使用对象存储（如 MinIO / RustFS），数据库中的 file\_path 字段存储相对路径。



路径规范：



数据类型	路径模板	示例

原始观测数据	gnss-raw/raw/{stationId}/{YYYY}/{MM}/{DD}/{filename}.rinex	gnss-raw/raw/BJFS/2026/07/27/BJFS\_1721987654.rinex

差分产品	gnss-diff/diff/{type}/{YYYY}/{MM}/{DD}/{filename}.rtcm	gnss-diff/diff/IONO/2026/07/27/iono\_1721987654.rtcm

外业照片	gnss-field/field/{taskId}/{timestamp}\_{filename}.jpg	gnss-field/field/T001/1721987654\_photo.jpg

遥感影像切片	gnss-imagery/imagery/{projectId}/{z}/{x}/{y}.png	gnss-imagery/imagery/P001/12/1024/2048.png

成员可根据自己本地环境自行决定对象存储的部署方式（本地 MinIO / 云存储），但路径规则必须遵循上述模板，以确保跨环境一致性。



三、微服务端口与依赖

微服务	端口	依赖的存储

bd-auth-service (MS-14)	        18093	PostgreSQL (auth\_svc) + Redis

bd-log-service (MS-16)	        18095	PostgreSQL (log\_svc) + Elasticsearch

bd-monitor-service (MS-15)	18094	PostgreSQL (monitor\_svc)

bd-gateway-service (MS-13)	18080	无独立存储（依赖其他服务）

bd-archive-service (MS-10)	18090	PostgreSQL (archive\_svc) + 对象存储

bd-metadata-service (MS-12)	18092	PostgreSQL (metadata\_svc) + Elasticsearch



如有其他问题，请联系数据库负责人。






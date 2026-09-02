# bd3-ntrip-caster-service

> BD3 项目微服务仓库 | 命名遵循《GitHub 微服务仓库命名规范 v1.1》  
> 对应服务：MS-08（NTRIP 播发服务）

## 项目简介
基于 Netty 的 NTRIP 播发服务，向客户端播发数据源并提供 SOURCETABLE 源表管理。

## 功能特性
- 挂载点管理
- 客户端管理
- 播发统计
- 数据播发
- SOURCETABLE 源表
- 广播注入/模拟源
- 事件与告警
- SSE 实时事件

## 技术栈
- 语言/框架：Java 21 / Spring Boot 3.5.x / Spring Cloud
- 服务注册与配置：Nacos（命名空间 `bd3`）
- 中间件：PostgreSQL 12.15 / Redis 6.2.6 / RocketMQ 5.3.2 / Elasticsearch 8.1.0
- 通信：REST（HTTP Interface）/ Netty TCP 2101 播发
- 统一响应：`{ "code": 0, "data": {} }`，非 0 视为错误

## 快速开始
```sh
# 1) 配置 Nacos（命名空间 bd3）及上述中间件连接
# 2) 启动
./mvnw spring-boot:run
# 或
java -jar target/bd3-ntrip-caster-service.jar
```
> 默认端口：**18088**；服务自动注册至 Nacos 命名空间 `bd3`。

## 相关仓库
- 前端：bd3-beidou-hmi-frontend
- 其他 BD3 微服务：见 BD3 Organization

## 维护者
- 负责人：待补充
- 联系方式：待补充

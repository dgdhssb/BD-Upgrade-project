# bd3-archive-service

> BD3 项目微服务仓库 | 命名遵循《GitHub 微服务仓库命名规范 v1.1》  
> 对应服务：MS-10（数据归档服务）

## 项目简介
对业务数据进行归档、备份与恢复管理，保障数据可追溯与可恢复。

## 功能特性
- 归档记录
- 备份任务
- 恢复任务
- 归档策略
- 存储分层统计
- 智能分析

## 技术栈
- 语言/框架：Java 21 / Spring Boot 3.5.x / Spring Cloud
- 服务注册与配置：Nacos（命名空间 `bd3`）
- 中间件：PostgreSQL 12.15 / Redis 6.2.6 / RocketMQ 5.3.2 / Elasticsearch 8.1.0
- 通信：REST（HTTP Interface）/ 归档/备份/恢复
- 统一响应：`{ "code": 0, "data": {} }`，非 0 视为错误

## 快速开始
```sh
# 1) 配置 Nacos（命名空间 bd3）及上述中间件连接
# 2) 启动
./mvnw spring-boot:run
# 或
java -jar target/bd3-archive-service.jar
```
> 默认端口：**18090**；服务自动注册至 Nacos 命名空间 `bd3`。

## 相关仓库
- 前端：bd3-beidou-hmi-frontend
- 其他 BD3 微服务：见 BD3 Organization

## 维护者
- 负责人：待补充
- 联系方式：待补充

# bd3-common-lib

## 项目简介
BD3 共享通用库：统一响应模型(Result/PageResult)、错误码(ErrorCode)、业务异常(BusinessException)、分页工具(PageUtils)、MyBatis-Plus 自动填充处理器；并作为依赖版本 BOM 统管 Spring Cloud / Alibaba / MyBatis-Plus / JJWT / springdoc 版本。

## 功能特性
- 统一响应模型 Result<T> / PageResult<T>
- 错误码枚举 ErrorCode 与业务异常 BusinessException
- 分页工具 PageUtils（MyBatis-Plus Page 适配）
- MyBatis-Plus 自动填充处理器（createTime/updateTime）
- 集中维护 Spring Cloud / Alibaba / MyBatis-Plus / JJWT / springdoc 版本 BOM

## 技术栈
- Java 21 / Spring Boot 3.5.13
- Spring Cloud 2025.0.2 (Alibaba 2025.0.0.0)
- MyBatis-Plus 3.5.7 / JJWT 0.12.6 / springdoc 2.8.17
- 作为 BOM 统一管理上述依赖版本

## 相关仓库
- bd3-user-auth-service（用户认证）
- bd3-data-archive-service（数据归档）
- bd3-data-lifecycle-service（生命周期）
- bd3-data-metadata-service（元数据）
- bd3-gateway-service（API 网关）

## 维护者
- BD3 项目组

> 本仓库遵循《GitHub 微服务仓库命名规范》：仓库名以 `bd3-` 开头、kebab-case、**必须 Private**。

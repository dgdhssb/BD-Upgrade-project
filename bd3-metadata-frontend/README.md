# bd3-metadata-frontend

> BD3 项目前端微服务模块 | 命名遵循《GitHub 微服务仓库命名规范 v1.1》  
> 对应后端服务：MS-12（元数据管理）| 所属聚合仓库：BD-Upgrade-project

## 项目简介
元数据存储/检索/统计的前端界面，对接 metadata-service（纯真实模式）。

## 功能特性
- 元数据存储
- 元数据检索
- 统计聚合
- Schema 管理
- 元数据治理

## 技术栈
- 框架：Vue 3 + Vite + TypeScript
- 状态管理：Pinia
- HTTP 客户端：axios（统一 `{ "code": 0, "data": {} }` 响应，非 0 抛错，纯真实模式无 mock）
- 后端端口：**18092**（经 vite 代理 `/api/v1/...` 转发）

## 快速开始
本目录是 beidou-hmi 聚合前端工程中的一个微服务模块（页面 + API 客户端），本身不独立运行，需放入聚合工程：

1. 将本目录下的 `*.vue` 复制到聚合前端 `src/views/`
2. 将本目录下的 `*.ts` 复制到聚合前端 `src/api/modules/`
3. 在 `vite.config.ts` 增加代理：`/api/v1/{module}` → 对应后端端口（见上方技术栈）
4. 安装依赖并启动：`npm install && npm run dev`

> 共享基建（App.vue / router / main.ts / request.ts / 公共组件）位于聚合前端工程，不重复放置。

## 相关仓库
- 聚合前端：bd3-beidou-hmi-frontend
- 后端服务：bd3-metadata-service
- 父仓库：BD-Upgrade-project

## 维护者
- 负责人：杨研
- 联系方式：neymar.yy.2007@qq.com

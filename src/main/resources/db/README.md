\# 数据库交付说明（BD-Upgrade-Project）



\## 数据库版本

\- PostgreSQL 16+

\- 字符集：UTF-8



\## 库名

bd\_upgrade\_db



\## Schema 清单

| Schema | 对应微服务 | 表数量 |

|--------|-----------|--------|

| auth\_svc | MS-14 | 4 |

| archive\_svc | MS-10 | 5 |

| lifecycle\_svc | MS-11 | 4 |

| mountpoint\_svc | MS-09 | 2 |

| monitor\_svc | MS-15 | 4 |

| metadata\_svc | MS-12 | 3 |

| log\_svc | MS-16 | 1 |

| \*\*合计\*\* | | \*\*23\*\* |



\## 初始化数据

\- 管理员账号：admin / 123456（需在生产环境修改密码）

\- 测试账号：testuser / 123456

\- 默认挂载点：RTCM33

\- 默认生命周期策略：RAW 数据（热存30天，近线90天，总365天）



\## 执行方式

psql -U postgres -d bd\_upgrade\_db -f init.sql


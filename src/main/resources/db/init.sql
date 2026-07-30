--
-- PostgreSQL database dump
--

\restrict RCRkZWZpHKyZTwcvZbFMaYwrnDebR3S5CEh9ajr5MPftXdfRl6PmbtdWiMDLaEm

-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: archive_svc; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA archive_svc;


ALTER SCHEMA archive_svc OWNER TO postgres;

--
-- Name: auth_svc; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA auth_svc;


ALTER SCHEMA auth_svc OWNER TO postgres;

--
-- Name: lifecycle_svc; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA lifecycle_svc;


ALTER SCHEMA lifecycle_svc OWNER TO postgres;

--
-- Name: log_svc; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA log_svc;


ALTER SCHEMA log_svc OWNER TO postgres;

--
-- Name: metadata_svc; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA metadata_svc;


ALTER SCHEMA metadata_svc OWNER TO postgres;

--
-- Name: monitor_svc; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA monitor_svc;


ALTER SCHEMA monitor_svc OWNER TO postgres;

--
-- Name: mountpoint_svc; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA mountpoint_svc;


ALTER SCHEMA mountpoint_svc OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: backup_task; Type: TABLE; Schema: archive_svc; Owner: postgres
--

CREATE TABLE archive_svc.backup_task (
    id character varying(32) NOT NULL,
    backup_type character varying(20) NOT NULL,
    target_type character varying(30) NOT NULL,
    source_path character varying(500),
    dest_path character varying(500),
    file_count integer,
    total_size bigint,
    status character varying(20) DEFAULT 'PENDING'::character varying,
    error_msg character varying(255),
    start_time timestamp without time zone,
    end_time timestamp without time zone,
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted smallint DEFAULT 0
);


ALTER TABLE archive_svc.backup_task OWNER TO postgres;

--
-- Name: TABLE backup_task; Type: COMMENT; Schema: archive_svc; Owner: postgres
--

COMMENT ON TABLE archive_svc.backup_task IS '备份任务表';


--
-- Name: differential_archive; Type: TABLE; Schema: archive_svc; Owner: postgres
--

CREATE TABLE archive_svc.differential_archive (
    id character varying(32) NOT NULL,
    product_type character varying(30) NOT NULL,
    station_id character varying(50),
    file_path character varying(500) NOT NULL,
    file_name character varying(200) NOT NULL,
    file_size bigint NOT NULL,
    checksum character varying(64) NOT NULL,
    epoch bigint NOT NULL,
    valid_start timestamp without time zone NOT NULL,
    valid_end timestamp without time zone NOT NULL,
    storage_tier character varying(20) DEFAULT 'HOT'::character varying,
    status character varying(20) DEFAULT 'ACTIVE'::character varying,
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    update_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted smallint DEFAULT 0
);


ALTER TABLE archive_svc.differential_archive OWNER TO postgres;

--
-- Name: TABLE differential_archive; Type: COMMENT; Schema: archive_svc; Owner: postgres
--

COMMENT ON TABLE archive_svc.differential_archive IS '差分改正产品归档表';


--
-- Name: field_data_archive; Type: TABLE; Schema: archive_svc; Owner: postgres
--

CREATE TABLE archive_svc.field_data_archive (
    id character varying(32) NOT NULL,
    task_id character varying(32) NOT NULL,
    collector_id character varying(50) NOT NULL,
    collector_name character varying(50),
    data_type character varying(30) NOT NULL,
    file_path character varying(500) NOT NULL,
    file_name character varying(200) NOT NULL,
    file_size bigint,
    checksum character varying(64),
    longitude numeric(12,8),
    latitude numeric(12,8),
    altitude numeric(10,4),
    form_data text,
    status character varying(20) DEFAULT 'ACTIVE'::character varying,
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    update_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted smallint DEFAULT 0
);


ALTER TABLE archive_svc.field_data_archive OWNER TO postgres;

--
-- Name: TABLE field_data_archive; Type: COMMENT; Schema: archive_svc; Owner: postgres
--

COMMENT ON TABLE archive_svc.field_data_archive IS '外业采集数据归档表';


--
-- Name: raw_data_archive; Type: TABLE; Schema: archive_svc; Owner: postgres
--

CREATE TABLE archive_svc.raw_data_archive (
    id character varying(32) NOT NULL,
    station_id character varying(50) NOT NULL,
    data_type character varying(20) NOT NULL,
    file_path character varying(500) NOT NULL,
    file_name character varying(200) NOT NULL,
    file_size bigint NOT NULL,
    checksum character varying(64) NOT NULL,
    epoch_start bigint NOT NULL,
    epoch_end bigint NOT NULL,
    storage_tier character varying(20) DEFAULT 'HOT'::character varying,
    status character varying(20) DEFAULT 'ACTIVE'::character varying,
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    update_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted smallint DEFAULT 0
);


ALTER TABLE archive_svc.raw_data_archive OWNER TO postgres;

--
-- Name: TABLE raw_data_archive; Type: COMMENT; Schema: archive_svc; Owner: postgres
--

COMMENT ON TABLE archive_svc.raw_data_archive IS '原始观测数据归档表';


--
-- Name: COLUMN raw_data_archive.storage_tier; Type: COMMENT; Schema: archive_svc; Owner: postgres
--

COMMENT ON COLUMN archive_svc.raw_data_archive.storage_tier IS '存储层级：HOT/NEARLINE/COLD';


--
-- Name: COLUMN raw_data_archive.status; Type: COMMENT; Schema: archive_svc; Owner: postgres
--

COMMENT ON COLUMN archive_svc.raw_data_archive.status IS '状态：ACTIVE/ARCHIVED/DELETED';


--
-- Name: restore_task; Type: TABLE; Schema: archive_svc; Owner: postgres
--

CREATE TABLE archive_svc.restore_task (
    id character varying(32) NOT NULL,
    backup_task_id character varying(32) NOT NULL,
    restore_point timestamp without time zone NOT NULL,
    target_path character varying(500) NOT NULL,
    status character varying(20) DEFAULT 'PENDING'::character varying,
    error_msg character varying(255),
    start_time timestamp without time zone,
    end_time timestamp without time zone,
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted smallint DEFAULT 0
);


ALTER TABLE archive_svc.restore_task OWNER TO postgres;

--
-- Name: TABLE restore_task; Type: COMMENT; Schema: archive_svc; Owner: postgres
--

COMMENT ON TABLE archive_svc.restore_task IS '数据恢复任务表';


--
-- Name: ntrip_user; Type: TABLE; Schema: auth_svc; Owner: postgres
--

CREATE TABLE auth_svc.ntrip_user (
    id character varying(32) NOT NULL,
    username character varying(50) NOT NULL,
    password character varying(255) NOT NULL,
    service_level character varying(20) DEFAULT 'FREE'::character varying,
    rate_limit integer DEFAULT 10,
    max_connections integer DEFAULT 1,
    status smallint DEFAULT 1,
    expire_time timestamp without time zone,
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    update_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE auth_svc.ntrip_user OWNER TO postgres;

--
-- Name: TABLE ntrip_user; Type: COMMENT; Schema: auth_svc; Owner: postgres
--

COMMENT ON TABLE auth_svc.ntrip_user IS 'NTRIP播发用户表';


--
-- Name: COLUMN ntrip_user.service_level; Type: COMMENT; Schema: auth_svc; Owner: postgres
--

COMMENT ON COLUMN auth_svc.ntrip_user.service_level IS '服务等级：FREE/PREMIUM/ENTERPRISE';


--
-- Name: sys_role_permission; Type: TABLE; Schema: auth_svc; Owner: postgres
--

CREATE TABLE auth_svc.sys_role_permission (
    id character varying(32) NOT NULL,
    role character varying(30) NOT NULL,
    permission character varying(100) NOT NULL,
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE auth_svc.sys_role_permission OWNER TO postgres;

--
-- Name: TABLE sys_role_permission; Type: COMMENT; Schema: auth_svc; Owner: postgres
--

COMMENT ON TABLE auth_svc.sys_role_permission IS '角色权限映射表';


--
-- Name: sys_user; Type: TABLE; Schema: auth_svc; Owner: postgres
--

CREATE TABLE auth_svc.sys_user (
    id character varying(32) NOT NULL,
    username character varying(50) NOT NULL,
    password character varying(255) NOT NULL,
    phone character varying(20),
    email character varying(100),
    role character varying(30) DEFAULT 'FIELD_WORKER'::character varying,
    status smallint DEFAULT 1,
    last_login_time timestamp without time zone,
    last_login_ip character varying(50),
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    update_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted smallint DEFAULT 0
);


ALTER TABLE auth_svc.sys_user OWNER TO postgres;

--
-- Name: TABLE sys_user; Type: COMMENT; Schema: auth_svc; Owner: postgres
--

COMMENT ON TABLE auth_svc.sys_user IS '系统用户表';


--
-- Name: COLUMN sys_user.id; Type: COMMENT; Schema: auth_svc; Owner: postgres
--

COMMENT ON COLUMN auth_svc.sys_user.id IS '雪花ID';


--
-- Name: COLUMN sys_user.role; Type: COMMENT; Schema: auth_svc; Owner: postgres
--

COMMENT ON COLUMN auth_svc.sys_user.role IS '角色：ADMIN/FIELD_WORKER/GUEST';


--
-- Name: COLUMN sys_user.status; Type: COMMENT; Schema: auth_svc; Owner: postgres
--

COMMENT ON COLUMN auth_svc.sys_user.status IS '状态：1正常，0禁用';


--
-- Name: COLUMN sys_user.deleted; Type: COMMENT; Schema: auth_svc; Owner: postgres
--

COMMENT ON COLUMN auth_svc.sys_user.deleted IS '逻辑删除：0未删，1已删';


--
-- Name: user_mountpoint_permission; Type: TABLE; Schema: auth_svc; Owner: postgres
--

CREATE TABLE auth_svc.user_mountpoint_permission (
    id character varying(32) NOT NULL,
    user_id character varying(32) NOT NULL,
    mountpoint character varying(50) NOT NULL,
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE auth_svc.user_mountpoint_permission OWNER TO postgres;

--
-- Name: TABLE user_mountpoint_permission; Type: COMMENT; Schema: auth_svc; Owner: postgres
--

COMMENT ON TABLE auth_svc.user_mountpoint_permission IS '用户挂载点访问权限表';


--
-- Name: cleanup_audit; Type: TABLE; Schema: lifecycle_svc; Owner: postgres
--

CREATE TABLE lifecycle_svc.cleanup_audit (
    id character varying(32) NOT NULL,
    data_type character varying(30) NOT NULL,
    archive_ids text,
    file_count integer,
    total_size bigint,
    operator character varying(50),
    reason character varying(500),
    approved_by character varying(50),
    status character varying(20) DEFAULT 'PENDING'::character varying,
    executed_time timestamp without time zone,
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    update_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted smallint DEFAULT 0
);


ALTER TABLE lifecycle_svc.cleanup_audit OWNER TO postgres;

--
-- Name: TABLE cleanup_audit; Type: COMMENT; Schema: lifecycle_svc; Owner: postgres
--

COMMENT ON TABLE lifecycle_svc.cleanup_audit IS '过期数据清理审计表';


--
-- Name: COLUMN cleanup_audit.archive_ids; Type: COMMENT; Schema: lifecycle_svc; Owner: postgres
--

COMMENT ON COLUMN lifecycle_svc.cleanup_audit.archive_ids IS '被清理的归档记录ID列表（JSON数组字符串）';


--
-- Name: COLUMN cleanup_audit.status; Type: COMMENT; Schema: lifecycle_svc; Owner: postgres
--

COMMENT ON COLUMN lifecycle_svc.cleanup_audit.status IS '状态：PENDING/APPROVED/EXECUTED/REJECTED';


--
-- Name: lifecycle_policy; Type: TABLE; Schema: lifecycle_svc; Owner: postgres
--

CREATE TABLE lifecycle_svc.lifecycle_policy (
    id character varying(32) NOT NULL,
    policy_name character varying(100) NOT NULL,
    data_type character varying(30) NOT NULL,
    hot_days integer NOT NULL,
    nearline_days integer NOT NULL,
    total_days integer NOT NULL,
    hot_path character varying(500),
    nearline_path character varying(500),
    cold_path character varying(500),
    enabled smallint DEFAULT 1,
    created_by character varying(50),
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    update_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted smallint DEFAULT 0
);


ALTER TABLE lifecycle_svc.lifecycle_policy OWNER TO postgres;

--
-- Name: TABLE lifecycle_policy; Type: COMMENT; Schema: lifecycle_svc; Owner: postgres
--

COMMENT ON TABLE lifecycle_svc.lifecycle_policy IS '数据生命周期策略配置表';


--
-- Name: COLUMN lifecycle_policy.data_type; Type: COMMENT; Schema: lifecycle_svc; Owner: postgres
--

COMMENT ON COLUMN lifecycle_svc.lifecycle_policy.data_type IS '数据类型：RAW/OBSERVATION/DIFFERENTIAL/FIELD';


--
-- Name: COLUMN lifecycle_policy.hot_days; Type: COMMENT; Schema: lifecycle_svc; Owner: postgres
--

COMMENT ON COLUMN lifecycle_svc.lifecycle_policy.hot_days IS '热存储天数';


--
-- Name: COLUMN lifecycle_policy.nearline_days; Type: COMMENT; Schema: lifecycle_svc; Owner: postgres
--

COMMENT ON COLUMN lifecycle_svc.lifecycle_policy.nearline_days IS '近线存储天数';


--
-- Name: COLUMN lifecycle_policy.total_days; Type: COMMENT; Schema: lifecycle_svc; Owner: postgres
--

COMMENT ON COLUMN lifecycle_svc.lifecycle_policy.total_days IS '总保留天数（含所有层级）';


--
-- Name: migration_task; Type: TABLE; Schema: lifecycle_svc; Owner: postgres
--

CREATE TABLE lifecycle_svc.migration_task (
    id character varying(32) NOT NULL,
    archive_id character varying(32) NOT NULL,
    source_tier character varying(20) NOT NULL,
    target_tier character varying(20) NOT NULL,
    source_path character varying(500),
    target_path character varying(500),
    file_size bigint,
    status character varying(20) DEFAULT 'PENDING'::character varying,
    retry_count integer DEFAULT 0,
    error_msg character varying(500),
    start_time timestamp without time zone,
    end_time timestamp without time zone,
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    update_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted smallint DEFAULT 0
);


ALTER TABLE lifecycle_svc.migration_task OWNER TO postgres;

--
-- Name: TABLE migration_task; Type: COMMENT; Schema: lifecycle_svc; Owner: postgres
--

COMMENT ON TABLE lifecycle_svc.migration_task IS '数据迁移任务表';


--
-- Name: COLUMN migration_task.source_tier; Type: COMMENT; Schema: lifecycle_svc; Owner: postgres
--

COMMENT ON COLUMN lifecycle_svc.migration_task.source_tier IS '源存储层级：HOT/NEARLINE/COLD';


--
-- Name: COLUMN migration_task.target_tier; Type: COMMENT; Schema: lifecycle_svc; Owner: postgres
--

COMMENT ON COLUMN lifecycle_svc.migration_task.target_tier IS '目标存储层级';


--
-- Name: COLUMN migration_task.status; Type: COMMENT; Schema: lifecycle_svc; Owner: postgres
--

COMMENT ON COLUMN lifecycle_svc.migration_task.status IS '状态：PENDING/RUNNING/COMPLETED/FAILED';


--
-- Name: storage_resource; Type: TABLE; Schema: lifecycle_svc; Owner: postgres
--

CREATE TABLE lifecycle_svc.storage_resource (
    id character varying(32) NOT NULL,
    storage_type character varying(20) NOT NULL,
    mount_point character varying(200) NOT NULL,
    total_capacity bigint NOT NULL,
    used_capacity bigint NOT NULL,
    free_capacity bigint NOT NULL,
    usage_percent numeric(5,2) NOT NULL,
    iops integer,
    read_latency_ms numeric(10,2),
    write_latency_ms numeric(10,2),
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE lifecycle_svc.storage_resource OWNER TO postgres;

--
-- Name: TABLE storage_resource; Type: COMMENT; Schema: lifecycle_svc; Owner: postgres
--

COMMENT ON TABLE lifecycle_svc.storage_resource IS '存储资源实时监控表';


--
-- Name: COLUMN storage_resource.storage_type; Type: COMMENT; Schema: lifecycle_svc; Owner: postgres
--

COMMENT ON COLUMN lifecycle_svc.storage_resource.storage_type IS '存储类型：HOT/NEARLINE/COLD';


--
-- Name: operation_audit; Type: TABLE; Schema: log_svc; Owner: postgres
--

CREATE TABLE log_svc.operation_audit (
    id character varying(32) NOT NULL,
    trace_id character varying(64),
    user_id character varying(32),
    username character varying(50),
    module character varying(50) NOT NULL,
    operation character varying(50) NOT NULL,
    params text,
    result text,
    ip character varying(50),
    cost_ms integer,
    success smallint DEFAULT 1,
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE log_svc.operation_audit OWNER TO postgres;

--
-- Name: TABLE operation_audit; Type: COMMENT; Schema: log_svc; Owner: postgres
--

COMMENT ON TABLE log_svc.operation_audit IS '操作审计日志表（关键操作冷备）';


--
-- Name: COLUMN operation_audit.trace_id; Type: COMMENT; Schema: log_svc; Owner: postgres
--

COMMENT ON COLUMN log_svc.operation_audit.trace_id IS '全链路追踪ID';


--
-- Name: COLUMN operation_audit.module; Type: COMMENT; Schema: log_svc; Owner: postgres
--

COMMENT ON COLUMN log_svc.operation_audit.module IS '所属模块：USER/AUTH/ARCHIVE/LIFECYCLE/MONITOR';


--
-- Name: COLUMN operation_audit.operation; Type: COMMENT; Schema: log_svc; Owner: postgres
--

COMMENT ON COLUMN log_svc.operation_audit.operation IS '操作类型：LOGIN/INSERT/UPDATE/DELETE/ARCHIVE/RESTORE';


--
-- Name: COLUMN operation_audit.success; Type: COMMENT; Schema: log_svc; Owner: postgres
--

COMMENT ON COLUMN log_svc.operation_audit.success IS '是否成功：1成功，0失败';


--
-- Name: metadata; Type: TABLE; Schema: metadata_svc; Owner: postgres
--

CREATE TABLE metadata_svc.metadata (
    id character varying(32) NOT NULL,
    archive_id character varying(32) NOT NULL,
    data_type character varying(30) NOT NULL,
    source character varying(100),
    station_id character varying(50),
    task_id character varying(32),
    coordinate_system character varying(20) DEFAULT 'CGCS2000'::character varying,
    resolution numeric(10,6),
    epoch_start bigint,
    epoch_end bigint,
    bounding_box character varying(200),
    file_count integer DEFAULT 1,
    total_size bigint DEFAULT 0,
    tags character varying(500),
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    update_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted smallint DEFAULT 0
);


ALTER TABLE metadata_svc.metadata OWNER TO postgres;

--
-- Name: TABLE metadata; Type: COMMENT; Schema: metadata_svc; Owner: postgres
--

COMMENT ON TABLE metadata_svc.metadata IS '存储元数据主表（供ES索引同步）';


--
-- Name: COLUMN metadata.archive_id; Type: COMMENT; Schema: metadata_svc; Owner: postgres
--

COMMENT ON COLUMN metadata_svc.metadata.archive_id IS '关联归档表ID';


--
-- Name: COLUMN metadata.data_type; Type: COMMENT; Schema: metadata_svc; Owner: postgres
--

COMMENT ON COLUMN metadata_svc.metadata.data_type IS '数据类型：RAW/DIFFERENTIAL/FIELD/IMAGERY';


--
-- Name: COLUMN metadata.bounding_box; Type: COMMENT; Schema: metadata_svc; Owner: postgres
--

COMMENT ON COLUMN metadata_svc.metadata.bounding_box IS '空间范围（GeoJSON格式字符串）';


--
-- Name: COLUMN metadata.tags; Type: COMMENT; Schema: metadata_svc; Owner: postgres
--

COMMENT ON COLUMN metadata_svc.metadata.tags IS '标签（逗号分隔）';


--
-- Name: metadata_sync_state; Type: TABLE; Schema: metadata_svc; Owner: postgres
--

CREATE TABLE metadata_svc.metadata_sync_state (
    id character varying(32) NOT NULL,
    sync_target character varying(30) NOT NULL,
    last_sync_id character varying(32),
    last_sync_time timestamp without time zone,
    pending_count integer DEFAULT 0,
    status character varying(20) DEFAULT 'RUNNING'::character varying,
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    update_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE metadata_svc.metadata_sync_state OWNER TO postgres;

--
-- Name: TABLE metadata_sync_state; Type: COMMENT; Schema: metadata_svc; Owner: postgres
--

COMMENT ON TABLE metadata_svc.metadata_sync_state IS '元数据同步状态（记录ES同步进度）';


--
-- Name: COLUMN metadata_sync_state.sync_target; Type: COMMENT; Schema: metadata_svc; Owner: postgres
--

COMMENT ON COLUMN metadata_svc.metadata_sync_state.sync_target IS '同步目标：ELASTICSEARCH/OTHER';


--
-- Name: COLUMN metadata_sync_state.last_sync_id; Type: COMMENT; Schema: metadata_svc; Owner: postgres
--

COMMENT ON COLUMN metadata_svc.metadata_sync_state.last_sync_id IS '最后一次同步的元数据记录ID';


--
-- Name: metadata_version; Type: TABLE; Schema: metadata_svc; Owner: postgres
--

CREATE TABLE metadata_svc.metadata_version (
    id character varying(32) NOT NULL,
    metadata_id character varying(32) NOT NULL,
    version integer NOT NULL,
    change_type character varying(20) NOT NULL,
    change_detail text,
    operator character varying(50),
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE metadata_svc.metadata_version OWNER TO postgres;

--
-- Name: TABLE metadata_version; Type: COMMENT; Schema: metadata_svc; Owner: postgres
--

COMMENT ON TABLE metadata_svc.metadata_version IS '元数据版本变更历史';


--
-- Name: COLUMN metadata_version.change_type; Type: COMMENT; Schema: metadata_svc; Owner: postgres
--

COMMENT ON COLUMN metadata_svc.metadata_version.change_type IS '变更类型：CREATE/UPDATE/DELETE';


--
-- Name: alert_record; Type: TABLE; Schema: monitor_svc; Owner: postgres
--

CREATE TABLE monitor_svc.alert_record (
    id character varying(32) NOT NULL,
    rule_id character varying(32),
    rule_name character varying(100),
    level character varying(20) NOT NULL,
    source character varying(100) NOT NULL,
    message character varying(500) NOT NULL,
    detail text,
    status character varying(20) DEFAULT 'ACTIVE'::character varying,
    resolved_time timestamp without time zone,
    resolved_by character varying(50),
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE monitor_svc.alert_record OWNER TO postgres;

--
-- Name: TABLE alert_record; Type: COMMENT; Schema: monitor_svc; Owner: postgres
--

COMMENT ON TABLE monitor_svc.alert_record IS '告警历史记录表';


--
-- Name: COLUMN alert_record.status; Type: COMMENT; Schema: monitor_svc; Owner: postgres
--

COMMENT ON COLUMN monitor_svc.alert_record.status IS '状态：ACTIVE/RESOLVED/IGNORED';


--
-- Name: alert_rule; Type: TABLE; Schema: monitor_svc; Owner: postgres
--

CREATE TABLE monitor_svc.alert_rule (
    id character varying(32) NOT NULL,
    rule_name character varying(100) NOT NULL,
    rule_type character varying(30) NOT NULL,
    target character varying(100),
    metric character varying(50) NOT NULL,
    operator character varying(10) NOT NULL,
    threshold character varying(50) NOT NULL,
    level character varying(20) NOT NULL,
    enabled smallint DEFAULT 1,
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    update_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted smallint DEFAULT 0
);


ALTER TABLE monitor_svc.alert_rule OWNER TO postgres;

--
-- Name: TABLE alert_rule; Type: COMMENT; Schema: monitor_svc; Owner: postgres
--

COMMENT ON TABLE monitor_svc.alert_rule IS '告警规则配置表';


--
-- Name: COLUMN alert_rule.rule_type; Type: COMMENT; Schema: monitor_svc; Owner: postgres
--

COMMENT ON COLUMN monitor_svc.alert_rule.rule_type IS '规则类型：THRESHOLD/STATUS/TREND';


--
-- Name: COLUMN alert_rule.operator; Type: COMMENT; Schema: monitor_svc; Owner: postgres
--

COMMENT ON COLUMN monitor_svc.alert_rule.operator IS '操作符：>/</>=/<=/==/!=';


--
-- Name: COLUMN alert_rule.level; Type: COMMENT; Schema: monitor_svc; Owner: postgres
--

COMMENT ON COLUMN monitor_svc.alert_rule.level IS '告警级别：INFO/WARNING/CRITICAL';


--
-- Name: qos_metric; Type: TABLE; Schema: monitor_svc; Owner: postgres
--

CREATE TABLE monitor_svc.qos_metric (
    id character varying(32) NOT NULL,
    service_type character varying(30) NOT NULL,
    metric_name character varying(50) NOT NULL,
    metric_value numeric(10,3) NOT NULL,
    unit character varying(20),
    target character varying(50),
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE monitor_svc.qos_metric OWNER TO postgres;

--
-- Name: TABLE qos_metric; Type: COMMENT; Schema: monitor_svc; Owner: postgres
--

COMMENT ON TABLE monitor_svc.qos_metric IS '服务质量（QoS）指标表';


--
-- Name: COLUMN qos_metric.service_type; Type: COMMENT; Schema: monitor_svc; Owner: postgres
--

COMMENT ON COLUMN monitor_svc.qos_metric.service_type IS '服务类型：NTRIP/DECODE/ARCHIVE/ROUTER';


--
-- Name: COLUMN qos_metric.metric_name; Type: COMMENT; Schema: monitor_svc; Owner: postgres
--

COMMENT ON COLUMN monitor_svc.qos_metric.metric_name IS '指标名称：LATENCY/THROUGHPUT/AVAILABILITY';


--
-- Name: system_status_snapshot; Type: TABLE; Schema: monitor_svc; Owner: postgres
--

CREATE TABLE monitor_svc.system_status_snapshot (
    id character varying(32) NOT NULL,
    service_name character varying(50) NOT NULL,
    instance_id character varying(50),
    status character varying(20) NOT NULL,
    cpu_usage numeric(5,2),
    memory_usage numeric(5,2),
    heap_used_mb integer,
    gc_count integer,
    gc_time_ms integer,
    thread_count integer,
    uptime_seconds integer,
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE monitor_svc.system_status_snapshot OWNER TO postgres;

--
-- Name: TABLE system_status_snapshot; Type: COMMENT; Schema: monitor_svc; Owner: postgres
--

COMMENT ON TABLE monitor_svc.system_status_snapshot IS '系统运行状态定时快照';


--
-- Name: COLUMN system_status_snapshot.service_name; Type: COMMENT; Schema: monitor_svc; Owner: postgres
--

COMMENT ON COLUMN monitor_svc.system_status_snapshot.service_name IS '服务名称（如 archive-service）';


--
-- Name: COLUMN system_status_snapshot.status; Type: COMMENT; Schema: monitor_svc; Owner: postgres
--

COMMENT ON COLUMN monitor_svc.system_status_snapshot.status IS '状态：UP/DOWN/DEGRADED';


--
-- Name: mountpoint; Type: TABLE; Schema: mountpoint_svc; Owner: postgres
--

CREATE TABLE mountpoint_svc.mountpoint (
    id character varying(32) NOT NULL,
    mountpoint character varying(50) NOT NULL,
    format character varying(20) NOT NULL,
    format_details character varying(100),
    description character varying(200),
    auth_required smallint DEFAULT 1,
    max_connections integer DEFAULT 50,
    current_connections integer DEFAULT 0,
    status character varying(20) DEFAULT 'ACTIVE'::character varying,
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    update_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted smallint DEFAULT 0
);


ALTER TABLE mountpoint_svc.mountpoint OWNER TO postgres;

--
-- Name: TABLE mountpoint; Type: COMMENT; Schema: mountpoint_svc; Owner: postgres
--

COMMENT ON TABLE mountpoint_svc.mountpoint IS 'NTRIP挂载点配置表';


--
-- Name: COLUMN mountpoint.mountpoint; Type: COMMENT; Schema: mountpoint_svc; Owner: postgres
--

COMMENT ON COLUMN mountpoint_svc.mountpoint.mountpoint IS '挂载点名称（如 RTCM33、RTCM32）';


--
-- Name: COLUMN mountpoint.format; Type: COMMENT; Schema: mountpoint_svc; Owner: postgres
--

COMMENT ON COLUMN mountpoint_svc.mountpoint.format IS '数据格式：RTCM3.2/RTCM3.3/CMR';


--
-- Name: COLUMN mountpoint.status; Type: COMMENT; Schema: mountpoint_svc; Owner: postgres
--

COMMENT ON COLUMN mountpoint_svc.mountpoint.status IS '状态：ACTIVE/INACTIVE/MAINTENANCE';


--
-- Name: mountpoint_connection; Type: TABLE; Schema: mountpoint_svc; Owner: postgres
--

CREATE TABLE mountpoint_svc.mountpoint_connection (
    id character varying(32) NOT NULL,
    mountpoint_id character varying(32) NOT NULL,
    client_ip character varying(50) NOT NULL,
    user_id character varying(32),
    username character varying(50),
    connected_at timestamp without time zone,
    disconnected_at timestamp without time zone,
    duration_seconds integer,
    bytes_sent bigint DEFAULT 0,
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE mountpoint_svc.mountpoint_connection OWNER TO postgres;

--
-- Name: TABLE mountpoint_connection; Type: COMMENT; Schema: mountpoint_svc; Owner: postgres
--

COMMENT ON TABLE mountpoint_svc.mountpoint_connection IS '挂载点连接历史记录表';


--
-- Name: COLUMN mountpoint_connection.duration_seconds; Type: COMMENT; Schema: mountpoint_svc; Owner: postgres
--

COMMENT ON COLUMN mountpoint_svc.mountpoint_connection.duration_seconds IS '连接持续时长（秒）';


--
-- Data for Name: backup_task; Type: TABLE DATA; Schema: archive_svc; Owner: postgres
--

COPY archive_svc.backup_task (id, backup_type, target_type, source_path, dest_path, file_count, total_size, status, error_msg, start_time, end_time, create_time, deleted) FROM stdin;
\.


--
-- Data for Name: differential_archive; Type: TABLE DATA; Schema: archive_svc; Owner: postgres
--

COPY archive_svc.differential_archive (id, product_type, station_id, file_path, file_name, file_size, checksum, epoch, valid_start, valid_end, storage_tier, status, create_time, update_time, deleted) FROM stdin;
\.


--
-- Data for Name: field_data_archive; Type: TABLE DATA; Schema: archive_svc; Owner: postgres
--

COPY archive_svc.field_data_archive (id, task_id, collector_id, collector_name, data_type, file_path, file_name, file_size, checksum, longitude, latitude, altitude, form_data, status, create_time, update_time, deleted) FROM stdin;
\.


--
-- Data for Name: raw_data_archive; Type: TABLE DATA; Schema: archive_svc; Owner: postgres
--

COPY archive_svc.raw_data_archive (id, station_id, data_type, file_path, file_name, file_size, checksum, epoch_start, epoch_end, storage_tier, status, create_time, update_time, deleted) FROM stdin;
\.


--
-- Data for Name: restore_task; Type: TABLE DATA; Schema: archive_svc; Owner: postgres
--

COPY archive_svc.restore_task (id, backup_task_id, restore_point, target_path, status, error_msg, start_time, end_time, create_time, deleted) FROM stdin;
\.


--
-- Data for Name: ntrip_user; Type: TABLE DATA; Schema: auth_svc; Owner: postgres
--

COPY auth_svc.ntrip_user (id, username, password, service_level, rate_limit, max_connections, status, expire_time, create_time, update_time) FROM stdin;
\.


--
-- Data for Name: sys_role_permission; Type: TABLE DATA; Schema: auth_svc; Owner: postgres
--

COPY auth_svc.sys_role_permission (id, role, permission, create_time) FROM stdin;
\.


--
-- Data for Name: sys_user; Type: TABLE DATA; Schema: auth_svc; Owner: postgres
--

COPY auth_svc.sys_user (id, username, password, phone, email, role, status, last_login_time, last_login_ip, create_time, update_time, deleted) FROM stdin;
2082822116108595202	admin	123456	13800001111	admin@test.com	ADMIN	1	\N	\N	2026-07-30 21:34:24.266806	2026-07-30 21:34:24.266806	0
2082822278658846721	default_user	123456	13800002222	default@test.com	FIELD_WORKER	1	\N	\N	2026-07-30 21:35:02.861249	2026-07-30 21:35:02.861249	0
\.


--
-- Data for Name: user_mountpoint_permission; Type: TABLE DATA; Schema: auth_svc; Owner: postgres
--

COPY auth_svc.user_mountpoint_permission (id, user_id, mountpoint, create_time) FROM stdin;
\.


--
-- Data for Name: cleanup_audit; Type: TABLE DATA; Schema: lifecycle_svc; Owner: postgres
--

COPY lifecycle_svc.cleanup_audit (id, data_type, archive_ids, file_count, total_size, operator, reason, approved_by, status, executed_time, create_time, update_time, deleted) FROM stdin;
\.


--
-- Data for Name: lifecycle_policy; Type: TABLE DATA; Schema: lifecycle_svc; Owner: postgres
--

COPY lifecycle_svc.lifecycle_policy (id, policy_name, data_type, hot_days, nearline_days, total_days, hot_path, nearline_path, cold_path, enabled, created_by, create_time, update_time, deleted) FROM stdin;
\.


--
-- Data for Name: migration_task; Type: TABLE DATA; Schema: lifecycle_svc; Owner: postgres
--

COPY lifecycle_svc.migration_task (id, archive_id, source_tier, target_tier, source_path, target_path, file_size, status, retry_count, error_msg, start_time, end_time, create_time, update_time, deleted) FROM stdin;
\.


--
-- Data for Name: storage_resource; Type: TABLE DATA; Schema: lifecycle_svc; Owner: postgres
--

COPY lifecycle_svc.storage_resource (id, storage_type, mount_point, total_capacity, used_capacity, free_capacity, usage_percent, iops, read_latency_ms, write_latency_ms, create_time) FROM stdin;
\.


--
-- Data for Name: operation_audit; Type: TABLE DATA; Schema: log_svc; Owner: postgres
--

COPY log_svc.operation_audit (id, trace_id, user_id, username, module, operation, params, result, ip, cost_ms, success, create_time) FROM stdin;
2082836928838410242	\N	\N	system	AuditLog	page	[1, 10, null, null, null, null]	com.example.bdupgradeproject.common.Result@7db6cab	0:0:0:0:0:0:0:1	252	1	2026-07-30 22:33:15.734118
2082836985457319937	\N	\N	system	User	list	[]	com.example.bdupgradeproject.common.Result@518a2965	0:0:0:0:0:0:0:1	10	1	2026-07-30 22:33:29.242733
2082837053740589057	\N	\N	system	AuditLog	list	[]	com.example.bdupgradeproject.common.Result@7303b253	0:0:0:0:0:0:0:1	4	1	2026-07-30 22:33:45.521983
2082837371853381634	\N	\N	system	AuditLog	page	[1, 10, null, null, null, null]	com.example.bdupgradeproject.common.Result@697050ba	0:0:0:0:0:0:0:1	3	1	2026-07-30 22:35:01.354429
\.


--
-- Data for Name: metadata; Type: TABLE DATA; Schema: metadata_svc; Owner: postgres
--

COPY metadata_svc.metadata (id, archive_id, data_type, source, station_id, task_id, coordinate_system, resolution, epoch_start, epoch_end, bounding_box, file_count, total_size, tags, create_time, update_time, deleted) FROM stdin;
\.


--
-- Data for Name: metadata_sync_state; Type: TABLE DATA; Schema: metadata_svc; Owner: postgres
--

COPY metadata_svc.metadata_sync_state (id, sync_target, last_sync_id, last_sync_time, pending_count, status, create_time, update_time) FROM stdin;
\.


--
-- Data for Name: metadata_version; Type: TABLE DATA; Schema: metadata_svc; Owner: postgres
--

COPY metadata_svc.metadata_version (id, metadata_id, version, change_type, change_detail, operator, create_time) FROM stdin;
\.


--
-- Data for Name: alert_record; Type: TABLE DATA; Schema: monitor_svc; Owner: postgres
--

COPY monitor_svc.alert_record (id, rule_id, rule_name, level, source, message, detail, status, resolved_time, resolved_by, create_time) FROM stdin;
\.


--
-- Data for Name: alert_rule; Type: TABLE DATA; Schema: monitor_svc; Owner: postgres
--

COPY monitor_svc.alert_rule (id, rule_name, rule_type, target, metric, operator, threshold, level, enabled, create_time, update_time, deleted) FROM stdin;
\.


--
-- Data for Name: qos_metric; Type: TABLE DATA; Schema: monitor_svc; Owner: postgres
--

COPY monitor_svc.qos_metric (id, service_type, metric_name, metric_value, unit, target, create_time) FROM stdin;
\.


--
-- Data for Name: system_status_snapshot; Type: TABLE DATA; Schema: monitor_svc; Owner: postgres
--

COPY monitor_svc.system_status_snapshot (id, service_name, instance_id, status, cpu_usage, memory_usage, heap_used_mb, gc_count, gc_time_ms, thread_count, uptime_seconds, create_time) FROM stdin;
\.


--
-- Data for Name: mountpoint; Type: TABLE DATA; Schema: mountpoint_svc; Owner: postgres
--

COPY mountpoint_svc.mountpoint (id, mountpoint, format, format_details, description, auth_required, max_connections, current_connections, status, create_time, update_time, deleted) FROM stdin;
\.


--
-- Data for Name: mountpoint_connection; Type: TABLE DATA; Schema: mountpoint_svc; Owner: postgres
--

COPY mountpoint_svc.mountpoint_connection (id, mountpoint_id, client_ip, user_id, username, connected_at, disconnected_at, duration_seconds, bytes_sent, create_time) FROM stdin;
\.


--
-- Name: backup_task backup_task_pkey; Type: CONSTRAINT; Schema: archive_svc; Owner: postgres
--

ALTER TABLE ONLY archive_svc.backup_task
    ADD CONSTRAINT backup_task_pkey PRIMARY KEY (id);


--
-- Name: differential_archive differential_archive_pkey; Type: CONSTRAINT; Schema: archive_svc; Owner: postgres
--

ALTER TABLE ONLY archive_svc.differential_archive
    ADD CONSTRAINT differential_archive_pkey PRIMARY KEY (id);


--
-- Name: field_data_archive field_data_archive_pkey; Type: CONSTRAINT; Schema: archive_svc; Owner: postgres
--

ALTER TABLE ONLY archive_svc.field_data_archive
    ADD CONSTRAINT field_data_archive_pkey PRIMARY KEY (id);


--
-- Name: raw_data_archive raw_data_archive_pkey; Type: CONSTRAINT; Schema: archive_svc; Owner: postgres
--

ALTER TABLE ONLY archive_svc.raw_data_archive
    ADD CONSTRAINT raw_data_archive_pkey PRIMARY KEY (id);


--
-- Name: restore_task restore_task_pkey; Type: CONSTRAINT; Schema: archive_svc; Owner: postgres
--

ALTER TABLE ONLY archive_svc.restore_task
    ADD CONSTRAINT restore_task_pkey PRIMARY KEY (id);


--
-- Name: ntrip_user ntrip_user_pkey; Type: CONSTRAINT; Schema: auth_svc; Owner: postgres
--

ALTER TABLE ONLY auth_svc.ntrip_user
    ADD CONSTRAINT ntrip_user_pkey PRIMARY KEY (id);


--
-- Name: ntrip_user ntrip_user_username_key; Type: CONSTRAINT; Schema: auth_svc; Owner: postgres
--

ALTER TABLE ONLY auth_svc.ntrip_user
    ADD CONSTRAINT ntrip_user_username_key UNIQUE (username);


--
-- Name: sys_role_permission sys_role_permission_pkey; Type: CONSTRAINT; Schema: auth_svc; Owner: postgres
--

ALTER TABLE ONLY auth_svc.sys_role_permission
    ADD CONSTRAINT sys_role_permission_pkey PRIMARY KEY (id);


--
-- Name: sys_user sys_user_pkey; Type: CONSTRAINT; Schema: auth_svc; Owner: postgres
--

ALTER TABLE ONLY auth_svc.sys_user
    ADD CONSTRAINT sys_user_pkey PRIMARY KEY (id);


--
-- Name: sys_user sys_user_username_key; Type: CONSTRAINT; Schema: auth_svc; Owner: postgres
--

ALTER TABLE ONLY auth_svc.sys_user
    ADD CONSTRAINT sys_user_username_key UNIQUE (username);


--
-- Name: user_mountpoint_permission user_mountpoint_permission_pkey; Type: CONSTRAINT; Schema: auth_svc; Owner: postgres
--

ALTER TABLE ONLY auth_svc.user_mountpoint_permission
    ADD CONSTRAINT user_mountpoint_permission_pkey PRIMARY KEY (id);


--
-- Name: user_mountpoint_permission user_mountpoint_permission_user_id_mountpoint_key; Type: CONSTRAINT; Schema: auth_svc; Owner: postgres
--

ALTER TABLE ONLY auth_svc.user_mountpoint_permission
    ADD CONSTRAINT user_mountpoint_permission_user_id_mountpoint_key UNIQUE (user_id, mountpoint);


--
-- Name: cleanup_audit cleanup_audit_pkey; Type: CONSTRAINT; Schema: lifecycle_svc; Owner: postgres
--

ALTER TABLE ONLY lifecycle_svc.cleanup_audit
    ADD CONSTRAINT cleanup_audit_pkey PRIMARY KEY (id);


--
-- Name: lifecycle_policy lifecycle_policy_data_type_key; Type: CONSTRAINT; Schema: lifecycle_svc; Owner: postgres
--

ALTER TABLE ONLY lifecycle_svc.lifecycle_policy
    ADD CONSTRAINT lifecycle_policy_data_type_key UNIQUE (data_type);


--
-- Name: lifecycle_policy lifecycle_policy_pkey; Type: CONSTRAINT; Schema: lifecycle_svc; Owner: postgres
--

ALTER TABLE ONLY lifecycle_svc.lifecycle_policy
    ADD CONSTRAINT lifecycle_policy_pkey PRIMARY KEY (id);


--
-- Name: migration_task migration_task_pkey; Type: CONSTRAINT; Schema: lifecycle_svc; Owner: postgres
--

ALTER TABLE ONLY lifecycle_svc.migration_task
    ADD CONSTRAINT migration_task_pkey PRIMARY KEY (id);


--
-- Name: storage_resource storage_resource_pkey; Type: CONSTRAINT; Schema: lifecycle_svc; Owner: postgres
--

ALTER TABLE ONLY lifecycle_svc.storage_resource
    ADD CONSTRAINT storage_resource_pkey PRIMARY KEY (id);


--
-- Name: operation_audit operation_audit_pkey; Type: CONSTRAINT; Schema: log_svc; Owner: postgres
--

ALTER TABLE ONLY log_svc.operation_audit
    ADD CONSTRAINT operation_audit_pkey PRIMARY KEY (id);


--
-- Name: metadata metadata_pkey; Type: CONSTRAINT; Schema: metadata_svc; Owner: postgres
--

ALTER TABLE ONLY metadata_svc.metadata
    ADD CONSTRAINT metadata_pkey PRIMARY KEY (id);


--
-- Name: metadata_sync_state metadata_sync_state_pkey; Type: CONSTRAINT; Schema: metadata_svc; Owner: postgres
--

ALTER TABLE ONLY metadata_svc.metadata_sync_state
    ADD CONSTRAINT metadata_sync_state_pkey PRIMARY KEY (id);


--
-- Name: metadata_version metadata_version_pkey; Type: CONSTRAINT; Schema: metadata_svc; Owner: postgres
--

ALTER TABLE ONLY metadata_svc.metadata_version
    ADD CONSTRAINT metadata_version_pkey PRIMARY KEY (id);


--
-- Name: alert_record alert_record_pkey; Type: CONSTRAINT; Schema: monitor_svc; Owner: postgres
--

ALTER TABLE ONLY monitor_svc.alert_record
    ADD CONSTRAINT alert_record_pkey PRIMARY KEY (id);


--
-- Name: alert_rule alert_rule_pkey; Type: CONSTRAINT; Schema: monitor_svc; Owner: postgres
--

ALTER TABLE ONLY monitor_svc.alert_rule
    ADD CONSTRAINT alert_rule_pkey PRIMARY KEY (id);


--
-- Name: qos_metric qos_metric_pkey; Type: CONSTRAINT; Schema: monitor_svc; Owner: postgres
--

ALTER TABLE ONLY monitor_svc.qos_metric
    ADD CONSTRAINT qos_metric_pkey PRIMARY KEY (id);


--
-- Name: system_status_snapshot system_status_snapshot_pkey; Type: CONSTRAINT; Schema: monitor_svc; Owner: postgres
--

ALTER TABLE ONLY monitor_svc.system_status_snapshot
    ADD CONSTRAINT system_status_snapshot_pkey PRIMARY KEY (id);


--
-- Name: mountpoint_connection mountpoint_connection_pkey; Type: CONSTRAINT; Schema: mountpoint_svc; Owner: postgres
--

ALTER TABLE ONLY mountpoint_svc.mountpoint_connection
    ADD CONSTRAINT mountpoint_connection_pkey PRIMARY KEY (id);


--
-- Name: mountpoint mountpoint_mountpoint_key; Type: CONSTRAINT; Schema: mountpoint_svc; Owner: postgres
--

ALTER TABLE ONLY mountpoint_svc.mountpoint
    ADD CONSTRAINT mountpoint_mountpoint_key UNIQUE (mountpoint);


--
-- Name: mountpoint mountpoint_pkey; Type: CONSTRAINT; Schema: mountpoint_svc; Owner: postgres
--

ALTER TABLE ONLY mountpoint_svc.mountpoint
    ADD CONSTRAINT mountpoint_pkey PRIMARY KEY (id);


--
-- Name: idx_backup_status; Type: INDEX; Schema: archive_svc; Owner: postgres
--

CREATE INDEX idx_backup_status ON archive_svc.backup_task USING btree (status);


--
-- Name: idx_diff_valid; Type: INDEX; Schema: archive_svc; Owner: postgres
--

CREATE INDEX idx_diff_valid ON archive_svc.differential_archive USING btree (valid_start, valid_end);


--
-- Name: idx_field_task; Type: INDEX; Schema: archive_svc; Owner: postgres
--

CREATE INDEX idx_field_task ON archive_svc.field_data_archive USING btree (task_id);


--
-- Name: idx_raw_station_time; Type: INDEX; Schema: archive_svc; Owner: postgres
--

CREATE INDEX idx_raw_station_time ON archive_svc.raw_data_archive USING btree (station_id, epoch_start, epoch_end);


--
-- Name: idx_restore_backup; Type: INDEX; Schema: archive_svc; Owner: postgres
--

CREATE INDEX idx_restore_backup ON archive_svc.restore_task USING btree (backup_task_id);


--
-- Name: idx_auth_rp_role; Type: INDEX; Schema: auth_svc; Owner: postgres
--

CREATE INDEX idx_auth_rp_role ON auth_svc.sys_role_permission USING btree (role);


--
-- Name: idx_auth_user_name; Type: INDEX; Schema: auth_svc; Owner: postgres
--

CREATE INDEX idx_auth_user_name ON auth_svc.sys_user USING btree (username);


--
-- Name: idx_ntrip_user_name; Type: INDEX; Schema: auth_svc; Owner: postgres
--

CREATE INDEX idx_ntrip_user_name ON auth_svc.ntrip_user USING btree (username);


--
-- Name: idx_ump_user; Type: INDEX; Schema: auth_svc; Owner: postgres
--

CREATE INDEX idx_ump_user ON auth_svc.user_mountpoint_permission USING btree (user_id);


--
-- Name: idx_mig_archive; Type: INDEX; Schema: lifecycle_svc; Owner: postgres
--

CREATE INDEX idx_mig_archive ON lifecycle_svc.migration_task USING btree (archive_id);


--
-- Name: idx_mig_status; Type: INDEX; Schema: lifecycle_svc; Owner: postgres
--

CREATE INDEX idx_mig_status ON lifecycle_svc.migration_task USING btree (status);


--
-- Name: idx_audit_time; Type: INDEX; Schema: log_svc; Owner: postgres
--

CREATE INDEX idx_audit_time ON log_svc.operation_audit USING btree (create_time);


--
-- Name: idx_audit_trace; Type: INDEX; Schema: log_svc; Owner: postgres
--

CREATE INDEX idx_audit_trace ON log_svc.operation_audit USING btree (trace_id);


--
-- Name: idx_audit_user; Type: INDEX; Schema: log_svc; Owner: postgres
--

CREATE INDEX idx_audit_user ON log_svc.operation_audit USING btree (user_id);


--
-- Name: idx_meta_archive; Type: INDEX; Schema: metadata_svc; Owner: postgres
--

CREATE INDEX idx_meta_archive ON metadata_svc.metadata USING btree (archive_id);


--
-- Name: idx_meta_station; Type: INDEX; Schema: metadata_svc; Owner: postgres
--

CREATE INDEX idx_meta_station ON metadata_svc.metadata USING btree (station_id);


--
-- Name: idx_meta_task; Type: INDEX; Schema: metadata_svc; Owner: postgres
--

CREATE INDEX idx_meta_task ON metadata_svc.metadata USING btree (task_id);


--
-- Name: idx_ver_metadata; Type: INDEX; Schema: metadata_svc; Owner: postgres
--

CREATE INDEX idx_ver_metadata ON metadata_svc.metadata_version USING btree (metadata_id);


--
-- Name: idx_alert_status; Type: INDEX; Schema: monitor_svc; Owner: postgres
--

CREATE INDEX idx_alert_status ON monitor_svc.alert_record USING btree (status);


--
-- Name: idx_alert_time; Type: INDEX; Schema: monitor_svc; Owner: postgres
--

CREATE INDEX idx_alert_time ON monitor_svc.alert_record USING btree (create_time);


--
-- Name: idx_qos_service; Type: INDEX; Schema: monitor_svc; Owner: postgres
--

CREATE INDEX idx_qos_service ON monitor_svc.qos_metric USING btree (service_type);


--
-- Name: idx_qos_time; Type: INDEX; Schema: monitor_svc; Owner: postgres
--

CREATE INDEX idx_qos_time ON monitor_svc.qos_metric USING btree (create_time);


--
-- Name: idx_status_service; Type: INDEX; Schema: monitor_svc; Owner: postgres
--

CREATE INDEX idx_status_service ON monitor_svc.system_status_snapshot USING btree (service_name);


--
-- Name: idx_status_time; Type: INDEX; Schema: monitor_svc; Owner: postgres
--

CREATE INDEX idx_status_time ON monitor_svc.system_status_snapshot USING btree (create_time);


--
-- Name: idx_conn_mnt; Type: INDEX; Schema: mountpoint_svc; Owner: postgres
--

CREATE INDEX idx_conn_mnt ON mountpoint_svc.mountpoint_connection USING btree (mountpoint_id);


--
-- Name: idx_conn_user; Type: INDEX; Schema: mountpoint_svc; Owner: postgres
--

CREATE INDEX idx_conn_user ON mountpoint_svc.mountpoint_connection USING btree (user_id);


--
-- Name: idx_mnt_name; Type: INDEX; Schema: mountpoint_svc; Owner: postgres
--

CREATE INDEX idx_mnt_name ON mountpoint_svc.mountpoint USING btree (mountpoint);


--
-- PostgreSQL database dump complete
--

\unrestrict RCRkZWZpHKyZTwcvZbFMaYwrnDebR3S5CEh9ajr5MPftXdfRl6PmbtdWiMDLaEm


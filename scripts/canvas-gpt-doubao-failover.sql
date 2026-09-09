BEGIN IMMEDIATE;

INSERT INTO channels (
    id,
    type,
    key,
    open_ai_organization,
    test_model,
    status,
    name,
    weight,
    created_time,
    test_time,
    response_time,
    base_url,
    other,
    balance,
    balance_updated_time,
    models,
    "group",
    used_quota,
    model_mapping,
    status_code_mapping,
    priority,
    auto_ban,
    other_info,
    tag,
    setting,
    param_override,
    header_override,
    remark,
    channel_info,
    settings
)
SELECT
    44,
    type,
    key,
    open_ai_organization,
    'gpt-5.6-sol',
    1,
    '画布 GPT→豆包自动灾备（隐藏）',
    10,
    CAST(strftime('%s', 'now') AS INTEGER),
    0,
    0,
    base_url,
    other,
    balance,
    balance_updated_time,
    'gpt-5.6-sol',
    'canvas',
    0,
    '{"gpt-5.6-sol":"doubao-seed-2-1-pro-260628"}',
    status_code_mapping,
    -10,
    auto_ban,
    other_info,
    tag,
    setting,
    param_override,
    header_override,
    '仅供画布 gpt-5.6-sol 首字前失败时自动切换豆包，不对客户公开',
    channel_info,
    settings
FROM channels
WHERE id = 40
  AND NOT EXISTS (SELECT 1 FROM channels WHERE id = 44 OR name = '画布 GPT→豆包自动灾备（隐藏）');

INSERT OR REPLACE INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT 'canvas', 'gpt-5.6-sol', 44, 1, -10, 10, tag
FROM channels
WHERE id = 44 AND name = '画布 GPT→豆包自动灾备（隐藏）';

COMMIT;

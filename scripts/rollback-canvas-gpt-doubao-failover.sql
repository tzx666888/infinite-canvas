BEGIN IMMEDIATE;

DELETE FROM abilities
WHERE channel_id = 44
  AND "group" = 'canvas'
  AND model = 'gpt-5.6-sol';

DELETE FROM channels
WHERE id = 44
  AND name = '画布 GPT→豆包自动灾备（隐藏）';

COMMIT;

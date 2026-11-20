begin;
select plan(22);

-- LRN-001b: a results read says how each variation's clicks were put in
-- sections (`context.sections`); every earlier key is checked as before.
-- The save itself is tested in klaviyo_results.test.sql.

select ok(private.klaviyo_context_ok(x::jsonb), 'kept: '||x)
  from unnest(array[
    '{}',
    '{"reported":true,"clicksBy":"message","botsLeftOut":3}',
    '{"sections":[]}',
    '{"sections":[{"variation":"VarA01","design":"A","from":"build","changed":false},
      {"variation":"VarB01","design":"B","from":"klaviyo","changed":true}]}',
    '{"sections":[{"variation":"Var_b-2","design":null,"from":null,"changed":false}]}'
  ]) x;

select ok(not private.klaviyo_context_ok(x::jsonb), 'refused: '||x)
  from unnest(array[
    -- Earlier keys, as before.
    '{"note":1}',
    '{"clicksBy":"none"}',
    -- Not a list, or more than a read holds.
    '{"sections":{"variation":"VarA01","design":"A","from":"build","changed":false}}',
    '{"sections":null}',
    -- A key missing, or one more.
    '{"sections":[{"variation":"VarA01","design":"A","from":"build"}]}',
    '{"sections":[{"variation":"VarA01","from":"build","changed":false}]}',
    '{"sections":[{"variation":"VarA01","design":"A","from":"build","changed":false,"html":"<p>x</p>"}]}',
    -- Each of its kind.
    '{"sections":[{"variation":"Var A/1","design":"A","from":"build","changed":false}]}',
    '{"sections":[{"variation":null,"design":"A","from":"build","changed":false}]}',
    '{"sections":[{"variation":"VarA01","design":"C","from":"build","changed":false}]}',
    '{"sections":[{"variation":"VarA01","design":"A","from":"guess","changed":false}]}',
    '{"sections":[{"variation":"VarA01","design":"A","from":"build","changed":"yes"}]}',
    '{"sections":[{"variation":"VarA01","design":"A","from":"build","changed":null}]}',
    '{"sections":["VarA01"]}'
  ]) x;

select ok(not private.klaviyo_context_ok(jsonb_build_object('sections',
  (select jsonb_agg('{"variation":"VarA01","design":"A","from":"build","changed":false}'::jsonb) from generate_series(1, 9)))),
  'refused: more than 8 variations');

-- Only the database's own functions call it.
select ok(not has_function_privilege(r, 'private.klaviyo_sections_from_ok(jsonb)', 'execute'), r||' cannot call it')
  from unnest(array['anon', 'authenticated']) r;

select * from finish();
rollback;

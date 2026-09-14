begin;

select plan(1);
select has_function('private', 'set_updated_at', 'updated_at trigger helper exists');

select * from finish();
rollback;


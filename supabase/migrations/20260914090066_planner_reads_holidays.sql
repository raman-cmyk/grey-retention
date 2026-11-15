-- PLN-034 (owner pick #34): "Plan next 15 days" runs in the worker
-- (service role), which plans around the workspace's country and its own
-- holidays and events (features/holidays/key-dates.ts). The worker may read
-- them, like the offer limits; every write still goes through the owner's
-- commands. The number is chosen at merge time (D24).

grant select on public.holidays, public.holiday_preferences to service_role;

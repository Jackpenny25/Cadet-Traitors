-- First create your name/PIN account on the updated website.
-- Replace the name below with YOUR account name, then run in SQL Editor.
-- This grants hosting to an existing account; it never handles PINs.
do $$
declare host_user uuid;
begin
 select id into host_user from private.accounts
 where name_key=lower(normalize(regexp_replace(trim('REPLACE_WITH_YOUR_NAME'),'\s+',' ','g'),NFKC));
 if host_user is null then raise exception 'Account not found. Create your name/PIN account on the updated website first.'; end if;
 insert into private.hosts(user_id) values(host_user) on conflict do nothing;
end $$;

-- Administrator-only recovery. Replace BOTH placeholders before running.
-- Do not commit a real PIN in this file. The new PIN must be four digits.
-- This resets the verifier and invalidates every application session for the account.
do $$
declare account uuid; new_pin text:='REPLACE_WITH_NEW_FOUR_DIGIT_PIN';
begin
 if new_pin !~ '^[0-9]{4}$' then raise exception 'Set a four-digit PIN first.'; end if;
 select id into account from private.accounts where name_key=lower(normalize(regexp_replace(trim('REPLACE_WITH_ACCOUNT_NAME'),'\s+',' ','g'),NFKC));
 if account is null then raise exception 'Account not found.'; end if;
 update private.accounts set pin_hash=extensions.crypt(new_pin,extensions.gen_salt('bf',12)),failed=0,locked_until=null where id=account;
 delete from private.sessions where account_id=account;
end $$;

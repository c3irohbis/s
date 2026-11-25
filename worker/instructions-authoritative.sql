-- Instructions authoritative content. No source Firestore data is changed.
-- Serializes this small owner-only card so count and revision checks are atomic.
create or replace function public.mutate_instruction_authoritative(
  p_key text, p_action text, p_title text, p_blocks jsonb,
  p_expected text, p_uid text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare old public.instructions%rowtype; result public.instructions%rowtype;
  stamp timestamptz; rev text; block jsonb; total_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtext('instructions-authoritative-v1'));
  stamp := clock_timestamp();
  select * into old from public.instructions where feature_key=p_key for update;
  if p_key is null or p_action is null or p_uid is null or length(p_uid)<1 or length(p_uid)>128 or p_title is null then raise exception 'invalid-input'; end if;
  if p_action not in ('save','delete') or p_key !~ '^[A-Za-z0-9_-]{1,80}$' then
    raise exception 'invalid-input';
  end if;
  if (old.feature_key is not null and old.deleted_at is null and old.content_hash is distinct from p_expected)
     or ((old.feature_key is null or old.deleted_at is not null) and p_expected is not null) then
    -- Repeating a completed delete is safe and cannot remove a recreated item.
    if p_action='delete' and old.deleted_at is not null and old.content_hash=p_expected then
      return jsonb_build_object('deleted',true,'key',p_key);
    end if;
    raise exception 'revision-conflict';
  end if;
  if p_action='delete' then
    if old.feature_key is not null and old.deleted_at is null then
      update public.instructions set deleted_at=stamp,updated_at=stamp,updated_by=p_uid where feature_key=p_key;
    end if;
    return jsonb_build_object('deleted',true,'key',p_key);
  end if;
  if jsonb_typeof(p_blocks) is distinct from 'array' then raise exception 'invalid-input'; end if;
  if jsonb_array_length(p_blocks)<1 or jsonb_array_length(p_blocks)>60
     or octet_length(p_blocks::text)>61440 or length(p_title)>200 then raise exception 'invalid-input'; end if;
  for block in select value from jsonb_array_elements(p_blocks) loop
    if jsonb_typeof(block) is distinct from 'object' then raise exception 'invalid-block'; end if;
    if (select count(*) from jsonb_object_keys(block))<>2 or not(block ? 't' and block ? 'v') then raise exception 'invalid-block'; end if;
    if jsonb_typeof(block->'t') is distinct from 'string' or jsonb_typeof(block->'v') is distinct from 'string' then raise exception 'invalid-block'; end if;
    if block->>'t' not in ('h','p','img') or length(trim(block->>'v'))=0 or length(block->>'v')>5000 then raise exception 'invalid-block'; end if;
    if block->>'t'='img' and block->>'v' !~ '^https://res[.]cloudinary[.]com/' then raise exception 'invalid-block'; end if;
  end loop;
  -- Bound the complete card below the API response cap, including room for metadata.
  select coalesce(sum(octet_length(blocks::text)+octet_length(coalesce(feature_title,''))+1200),0) into total_bytes
    from public.instructions where deleted_at is null and feature_key<>p_key;
  if total_bytes+octet_length(p_blocks::text)+octet_length(p_title)+1200>245760 then raise exception 'card-size-limit'; end if;
  if (old.feature_key is null or old.deleted_at is not null)
     and (select count(*) from public.instructions where deleted_at is null)>=200 then
    raise exception 'item-limit';
  end if;
  -- content_hash is the opaque authoritative revision token, not a content digest.
  -- On a lost-response retry, Worker checks identical content after revision conflict.
  rev := md5(p_key || stamp::text || random()::text);
  insert into public.instructions(feature_key,feature_title,blocks,created_at,updated_at,updated_by,deleted_at,content_hash,synced_at)
  values(p_key,p_title,p_blocks,coalesce(old.created_at,stamp),stamp,p_uid,null,rev,stamp)
  on conflict(feature_key) do update set feature_title=excluded.feature_title,blocks=excluded.blocks,
    created_at=excluded.created_at,updated_at=excluded.updated_at,updated_by=excluded.updated_by,
    deleted_at=null,content_hash=excluded.content_hash,synced_at=excluded.synced_at
  returning * into result;
  return to_jsonb(result);
end $$;
revoke all on function public.mutate_instruction_authoritative(text,text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.mutate_instruction_authoritative(text,text,text,jsonb,text,text) to service_role;

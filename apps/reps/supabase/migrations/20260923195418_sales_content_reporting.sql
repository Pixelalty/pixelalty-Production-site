create function px_private.public_config() returns jsonb language sql stable security definer set search_path='' as $$ select jsonb_build_object('packages',(select jsonb_agg(jsonb_build_object('id',id,'name',name,'code',code,'price_cents',price_cents,'commission_cents',commission_cents) order by price_cents) from public.px_packages where active),'recruiting_open',(select (value->>'recruiting_open')::boolean from public.px_settings)); $$;
create function public.px_public_config() returns jsonb language sql security invoker set search_path='' as $$select px_private.public_config()$$;
revoke execute on function public.px_public_config() from public;
grant usage on schema px_private to anon;
grant execute on function public.px_public_config(),px_private.public_config() to anon,authenticated;

create function px_private.report(kind text,p jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;uid uuid:=auth.uid();
begin
 if uid is null or (not exists(select 1 from public.px_reps where id=uid) and not px_private.has_role(array['owner','sales_admin','finance_admin','content_admin','compliance_admin','support','manager'])) then raise exception 'An authorized account is required.' using errcode='42501';end if;
 if kind='dashboard' then
  return jsonb_build_object(
  'calls_today',(select count(*) from public.px_calls where rep_id=uid and (created_at at time zone (select timezone from public.px_reps where id=uid))::date=(now() at time zone (select timezone from public.px_reps where id=uid))::date),
  'calls',(select count(*) from public.px_calls where rep_id=uid),
  'sales',(select count(*) from public.px_deals where rep_id=uid and stage='paid'),
  'xp',(select coalesce(sum(amount),0) from public.px_xp where rep_id=uid),
  'leads',(select count(*) from public.px_businesses where owner_id=uid and not dnc and not customer and not archived),
  'followups',(select count(*) from public.px_followups where rep_id=uid and status='open' and due_at<=now()),
  'earned',(select coalesce(sum(amount_cents),0) from public.px_commissions where rep_id=uid and status not in ('reversed','recovery_review')),
  'transferred',(select coalesce(sum(amount_cents-reversed_cents),0) from public.px_commissions where rep_id=uid and transfer_id is not null),
  'activity',(select coalesce(jsonb_agg(t),'[]') from (select (x.created_at at time zone r.timezone)::date as "day",sum(x.amount) xp,count(*) filter(where x.source='call') calls from public.px_xp x join public.px_reps r on r.id=x.rep_id where x.rep_id=uid and x.created_at>now()-interval '40 days' group by 1 order by 1 desc)t));
 elsif kind='leaderboard' then
  with stats as(select r.id,r.name,r.code,r.bio,coalesce((select sum(x.amount) from public.px_xp x where x.rep_id=r.id),0) xp,(select count(*) from public.px_deals d join public.px_payments py on py.deal_id=d.id where d.rep_id=r.id and py.refunded_cents=0 and not py.disputed) sales,(select count(*) from public.px_calls c where c.rep_id=r.id) calls from public.px_reps r where r.status='active'),ranked as(select *,row_number() over(order by sales desc,xp desc,code) rank from stats),me as(select rank from ranked where id=uid)
  select coalesce(jsonb_agg(to_jsonb(t) order by rank),'[]') into result from ranked t where rank<=50 or abs(rank-coalesce((select rank from me),0))<=2;return result;
 elsif kind='import' then
  perform px_private.require_role(array['sales_admin']);
  select jsonb_build_object('accepted',count(*) filter(where status='accepted'),'rejected',count(*) filter(where status='rejected'),'pending',count(*) filter(where status='pending')) into result from public.px_import_rows where batch_id=(p->>'id')::uuid;return result;
 elsif kind='admin' then
  perform px_private.require_role(array['sales_admin']);
  return jsonb_build_object('applicants',(select count(*) from public.px_applicants where stage='new'),'active_reps',(select count(*) from public.px_reps where status='active'),'available_leads',(select count(*) from public.px_businesses where owner_id is null and not dnc and not customer and not archived),'paid_deals',(select count(*) from public.px_deals where stage='paid'));
 else raise exception 'Unknown report.';end if;
end $$;
create function public.px_report(kind text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.report(kind,p)$$;
revoke execute on function public.px_report(text,jsonb) from public,anon;
grant execute on function public.px_report(text,jsonb),px_private.report(text,jsonb) to authenticated;

insert into public.px_content(kind,slug,title,body,required) values
('lesson','welcome','Welcome to Pixelalty','Pixelalty helps businesses present their services clearly with professional websites. Learn the business before recommending a package. Your role is to qualify needs, document accurate notes, and help a customer choose an appropriate scope.',true),
('lesson','packages','Packages & commissions','Launch: $799 sale, $125 standard commission. Growth: $1,299 sale, $250 commission. Premium: $1,999 sale, $400 commission. Advanced: $2,999+ custom scope, $600 standard commission. A higher Advanced sale price does not automatically increase commission. Verify current package versions in the portal. Earnings are not guaranteed.',true),
('lesson','prospecting','Prospecting responsibly','Work only assigned businesses. Verify the prospect timezone. Check the approved calling window. Do not call suppressed numbers or businesses that asked not to be contacted. Do not export company prospect lists.',true),
('lesson','opener','Starting a conversation','Introduce yourself and Pixelalty. Ask whether now is a suitable time for a brief business conversation. Use a relevant observation and one question. If the person declines, respect their decision.',true),
('lesson','qualification','Understanding the business','Ask about their services, customers, current website, and what they want to improve. Record relevant business needs. Do not request passwords, banking details, or personal sensitive information.',true),
('lesson','objections','Responding to concerns','Listen first, acknowledge the concern, and ask a clarifying question. Explain actual scope and value. Do not promise rankings, revenue, unlimited changes, or turnaround times that are not approved.',true),
('lesson','followup','Following up','Agree on a useful next step and a specific time. Schedule a follow-up using the prospect timezone. Record the context so your next conversation is relevant. Respect every opt-out.',true),
('lesson','closing','Creating an accurate deal','Confirm package scope and customer email. Create the deal in the portal, then use its attributed checkout link. A call marked Sale Reported is not a verified sale. Only a verified payment creates a commission.',true),
('lesson','crm','Keeping useful records','Record calls promptly, choose an accurate disposition, and write factual notes. Repeated logging of the same business does not earn repeated activity credit. Use follow-ups to record commitments.',true),
('lesson','compliance','Contact and data boundaries','Use only approved calling methods and hours. Recording, automated dialing, SMS, and AI calling are disabled in this release. Add an opt-out to Do Not Contact immediately. Escalate uncertainty to an administrator.',true),
('lesson','expectations','Setting customer expectations','Be specific about approved scope and next steps. The paid deal creates a fulfillment handoff. A commission transfer to a connected account is separate from a payout to a bank. Refunds and disputes can place commissions under review.',true),
('script','opening','Opening','Hi, this is [your name] with Pixelalty. Is now a suitable time for a brief question about [business name]’s website?\n\nWhat would you most like your website to do better for your business?',false),
('script','busy','“I’m busy”','Of course. Is there a better day and time for a brief conversation, or would you prefer that I do not follow up?',false),
('script','price','“It costs too much”','I understand that budget matters. Which parts of the project are most important to you? We can look at the approved packages and determine whether there is an appropriate fit.',false),
('script','already-website','“We have a website”','That makes sense. Are you happy with how it presents your services and helps customers take the next step?',false),
('script','send-info','“Send information”','Certainly. Which business email should I use, and what would be most useful for you to review? When, if at all, would a follow-up be welcome?',false),
('knowledge','payments','Understanding commission status','Verified payments create commissions using the deal’s saved package version. The default hold is seven days; settlement, account readiness, refunds, disputes, and manual holds also affect eligibility. A Connect transfer is not a bank payout.',false);
do $$ declare q uuid;begin
 insert into public.px_content(kind,slug,title,body,required) values('quiz','readiness','Sales readiness check','[{"question":"What is the standard Launch commission?","options":["$100","$125","$250"]},{"question":"A $3,500 Advanced sale normally earns what commission?","options":["$700","$600","$350"]},{"question":"When is a sale verified?","options":["After the server verifies payment","When a rep selects Sale Reported","When a checkout link is copied"]},{"question":"What should you do after a do-not-contact request?","options":["Try again tomorrow","Record DNC and stop contact","Give it to another rep"]},{"question":"Does a Connect transfer prove a bank payout?","options":["No; bank payouts are tracked separately","Yes"]}]',true) returning id into q;
 insert into px_private.quiz_keys values(q,'[1,1,0,1,0]');
end $$;

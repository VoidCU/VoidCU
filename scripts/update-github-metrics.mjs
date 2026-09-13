import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const user = 'VoidCU';
const output = fileURLToPath(new URL('../assets/', import.meta.url));
async function graphql(query, variables = {}) {
  const payload = { query, variables };
  let json;
  if (process.env.GITHUB_TOKEN) {
    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw Error(`GitHub API returned ${response.status}`);
    json = await response.json();
  } else {
    json = JSON.parse(execFileSync('gh', ['api', 'graphql', '--input', '-'], { input: JSON.stringify(payload), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
  }
  if (json.errors) throw Error(json.errors.map(e => e.message).join('; '));
  return json.data;
}
const { user: account } = await graphql(`query($login:String!){user(login:$login){
  login name createdAt followers(first:28){totalCount nodes{login avatarUrl}} following{totalCount}
  starredRepositories(first:4,orderBy:{field:STARRED_AT,direction:DESC}){totalCount edges{starredAt node{nameWithOwner description isPrivate stargazerCount forkCount primaryLanguage{name color}}}}
  contributionsCollection{startedAt endedAt totalCommitContributions totalIssueContributions totalPullRequestContributions totalPullRequestReviewContributions totalRepositoriesWithContributedCommits contributionCalendar{totalContributions weeks{contributionDays{date contributionCount contributionLevel}}}}
}}`, { login: user });
if (!account) throw Error('GitHub user not found');
let repos = [], cursor = null;
do {
  const { user: result } = await graphql(`query($login:String!,$cursor:String){user(login:$login){repositories(first:100,after:$cursor,privacy:PUBLIC,ownerAffiliations:OWNER){
    pageInfo{hasNextPage endCursor} nodes{isFork stargazerCount forkCount diskUsage
      languages(first:100){edges{size node{name color}}}
      issuesOpen:issues(states:OPEN){totalCount} issuesClosed:issues(states:CLOSED){totalCount}
      prsOpen:pullRequests(states:OPEN){totalCount} prsClosed:pullRequests(states:CLOSED){totalCount} prsMerged:pullRequests(states:MERGED){totalCount}
    }
  }}}`, { login: user, cursor });
  repos.push(...result.repositories.nodes);
  cursor = result.repositories.pageInfo.hasNextPage ? result.repositories.pageInfo.endCursor : null;
} while(cursor);

const snapshot=new Date().toISOString().slice(0,10);
const weeks = account.contributionsCollection.contributionCalendar.weeks
  .map(week => ({ contributionDays: week.contributionDays.filter(day => day.date <= snapshot) }))
  .filter(week => week.contributionDays.length);
const days = weeks.flatMap(w => w.contributionDays);
const contributionTotal = days.reduce((total,day) => total+day.contributionCount,0);
let longest = 0, run = 0;
for (const d of days) { run = d.contributionCount ? run + 1 : 0; longest = Math.max(longest, run); }
let last = days.length - 1;
if (days[last]?.date === snapshot && !days[last].contributionCount) last--;
let current = 0;
for (let i=last;i>=0 && days[i].contributionCount;i--) current++;
const sum = key => repos.reduce((n,r) => n+(typeof r[key]==='object'?r[key].totalCount:r[key]),0);
const languages = new Map();
for (const repo of repos.filter(r=>!r.isFork)) for (const e of repo.languages.edges) {
  const previous=languages.get(e.node.name) || { name:e.node.name, color:e.node.color || '#8b949e', bytes:0 };
  previous.bytes+=e.size; languages.set(previous.name,previous);
}
const allLanguages=[...languages.values()].sort((a,b)=>b.bytes-a.bytes);
const totalBytes=allLanguages.reduce((n,l)=>n+l.bytes,0);
const top=allLanguages.slice(0,6);
const otherBytes=totalBytes-top.reduce((n,l)=>n+l.bytes,0);
if(otherBytes) top.push({name:'Other',bytes:otherBytes,color:'#8b949e'});
const avatars=await Promise.all(account.followers.nodes.map(async person=>{
  try{
    const url=new URL(person.avatarUrl);
    if(url.hostname!=='avatars.githubusercontent.com') return {...person,image:null};
    url.searchParams.set('s','64');
    const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
    const mime=response.headers.get('content-type');
    if(!response.ok || !['image/png','image/jpeg','image/webp'].includes(mime)) return {...person,image:null};
    return {...person,image:`data:${mime};base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`};
  }catch{return {...person,image:null};}
}));
const esc=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const n=v=>Number(v).toLocaleString('en-US');
const wrap=(value,max=73)=>{
  const lines=[''];
  for(const word of String(value || '').split(/\s+/)) {
    if((lines.at(-1)+' '+word).trim().length>max) lines.push(word);
    else lines[lines.length-1]=(lines.at(-1)+' '+word).trim();
  }
  return lines.slice(0,2);
};
for(const theme of ['light','dark']) {
 const c=theme==='dark'?{bg:'#0d1117',fg:'#e6edf3',muted:'#919cae',line:'#30363d',blue:'#58a6ff',green:'#3fb950',purple:'#bc8cff',red:'#f85149',empty:'#161b22'}:{bg:'#ffffff',fg:'#1f2328',muted:'#59636e',line:'#d1d9e0',blue:'#0969da',green:'#1a7f37',purple:'#8250df',red:'#cf222e',empty:'#ebedf0'};
 let body='';
 const text=(x,y,value,size=17,color=c.fg,weight=400)=>`<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}">${esc(value)}</text>`;
 const section=(y,label)=>`<path d="M28 ${y-28}h704" stroke="${c.line}"/>`+text(28,y,label,21,c.blue,600);
 const metric=(x,y,label,value)=>text(x,y,n(value),23,c.fg,600)+text(x+102,y,label,16,c.muted);
 body+=text(28,42,account.name || user,25,c.fg,700)+text(28,72,`@${user} · Joined ${account.createdAt.slice(0,10)}`,16,c.muted)+text(732,42,'GITHUB METRICS',13,c.blue,600).replace('x="732"','x="732" text-anchor="end"');
 body+=section(123,'Activity & community');
 const activity=account.contributionsCollection;
 body+=metric(28,166,'commits · past year',activity.totalCommitContributions)+metric(402,166,'followers',account.followers.totalCount);
 body+=metric(28,203,'pull requests · past year',activity.totalPullRequestContributions)+metric(402,203,'following',account.following.totalCount);
 body+=metric(28,240,'reviews · past year',activity.totalPullRequestReviewContributions)+metric(402,240,'starred repositories',account.starredRepositories.totalCount);
 body+=metric(28,277,'issues · past year',activity.totalIssueContributions)+metric(402,277,'repos contributed to*',activity.totalRepositoriesWithContributedCommits);
 body+=text(28,309,'* Repositories with commit contributions in the past year.',13,c.muted);
 body+=section(360,'Public repository overview');
 body+=metric(28,401,'public repositories',repos.length)+metric(402,401,'stars received',sum('stargazerCount'));
 body+=metric(28,438,'original repositories',repos.filter(r=>!r.isFork).length)+metric(402,438,'forks received',sum('forkCount'));
 body+=text(28,473,'On owned public repositories · includes forks unless noted',14,c.muted);
 const bars=(x,y,label,parts)=>{
  let out=text(x,y,label,17,c.fg,600), left=x;
  const total=parts.reduce((s,p)=>s+p[1],0);
  out+=`<rect x="${x}" y="${y+14}" width="334" height="8" rx="4" fill="${c.empty}"/>`;
  for(const [,value,color] of parts){const w=total?334*value/total:0;out+=`<rect x="${left}" y="${y+14}" width="${w}" height="8" fill="${color}"/>`;left+=w;}
  parts.forEach(([title,value,color],i)=>out+=text(x+(i%2)*167,y+48+Math.floor(i/2)*25,`${n(value)} ${title}`,15,color));
  return out;
 };
 body+=bars(28,510,'Issues',[['open',sum('issuesOpen'),c.green],['closed',sum('issuesClosed'),c.purple]]);
 body+=bars(398,510,'Pull requests',[['open',sum('prsOpen'),c.green],['merged',sum('prsMerged'),c.purple],['closed',sum('prsClosed'),c.red]]);
 body+=section(636,'Most used languages');
 body+=text(28,665,'By code bytes in owned, non-fork public repositories',14,c.muted);
 let bx=28;
 for(const language of top){const w=totalBytes?704*language.bytes/totalBytes:0;body+=`<rect x="${bx}" y="686" width="${w}" height="10" fill="${language.color}"/>`;bx+=w;}
 top.forEach((l,i)=>{const x=28+(i%3)*240,y=731+Math.floor(i/3)*31;body+=`<circle cx="${x+5}" cy="${y-5}" r="5" fill="${l.color}"/>`+text(x+18,y,`${l.name} ${(100*l.bytes/totalBytes).toFixed(1)}%`,15);});
 body+=section(852,'Contributions calendar');
 body+=text(28,884,`${n(contributionTotal)} contributions · ${days[0].date} to ${days.at(-1).date}`,16,c.muted);
 const colors=theme==='dark'?['#161b22','#0e4429','#006d32','#26a641','#39d353']:['#ebedf0','#9be9a8','#40c463','#30a14e','#216e39'];
 const levels={NONE:0,FIRST_QUARTILE:1,SECOND_QUARTILE:2,THIRD_QUARTILE:3,FOURTH_QUARTILE:4};
 weeks.forEach((week,w)=>week.contributionDays.forEach(day=>{
  const d=new Date(`${day.date}T00:00:00Z`).getUTCDay(), x=55+w*11+d*11,y=972+w*4-d*4;
  const level=levels[day.contributionLevel] || 0, height=level?5+level*7:0;
  const fill=colors[level];
  body+=`<g><title>${day.date}: ${day.contributionCount} contributions</title><path d="M${x} ${y-height}l10 4 10-4-10-4z" fill="${fill}" stroke="${c.bg}" stroke-width=".5"/>`;
  if(height)body+=`<path d="M${x} ${y-height}v${height}l10 4v-${height}z" fill="${fill}" opacity=".65"/><path d="M${x+10} ${y-height+4}v${height}l10-4v-${height}z" fill="${fill}" opacity=".85"/>`;
  body+='</g>';
 }));
 body+=metric(28,1250,'day current streak',current)+metric(402,1250,'day best streak',longest);
 body+=metric(28,1290,'most contributions/day',Math.max(...days.map(d=>d.contributionCount)))+text(402,1290,(contributionTotal/days.length).toFixed(1),23,c.fg,600)+text(504,1290,'average per day',16,c.muted);
 body+=text(28,1324,'Streaks count contribution days, not only commits · displayed year · UTC',13,c.muted);
 body+=section(1376,'Recently starred repositories');
 const starred=account.starredRepositories.edges.filter(e=>!e.node.isPrivate);
 starred.forEach((e,i)=>{const r=e.node,y=1419+i*124;body+=text(28,y,r.nameWithOwner,18,c.blue,600);wrap(r.description).forEach((line,j)=>body+=text(28,y+27+j*23,line,15,c.muted));body+=text(28,y+84,`${r.primaryLanguage?.name || 'No primary language'} · ${n(r.stargazerCount)} stars · ${n(r.forkCount)} forks · starred ${e.starredAt.slice(0,10)}`,14,c.muted);});
 if(!starred.length) body+=text(28,1420,'No public starred repositories to display.',16,c.muted);
 const followersY=1420+Math.max(starred.length,1)*124;
 body+=section(followersY,`${n(account.followers.totalCount)} followers`);
 avatars.forEach((p,i)=>{const x=28+(i%14)*50,y=followersY+24+Math.floor(i/14)*55;body+=`<clipPath id="avatar-${i}"><circle cx="${x+20}" cy="${y+20}" r="20"/></clipPath><g><title>${esc(p.login)}</title>`;if(p.image)body+=`<image href="${p.image}" x="${x}" y="${y}" width="40" height="40" clip-path="url(#avatar-${i})"/>`;else body+=`<circle cx="${x+20}" cy="${y+20}" r="20" fill="${c.empty}"/>`+text(x+12,y+27,p.login[0].toUpperCase(),19,c.blue);body+='</g>';});
 const end=followersY+Math.ceil(avatars.length/14)*55+60;
 body+=text(28,end,`Updated ${snapshot} UTC · GitHub API · refreshes daily`,14,c.muted);
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="760" height="${end+30}" viewBox="0 0 760 ${end+30}" role="img"><title>${user} GitHub activity, repositories, languages, contribution calendar, recently starred repositories and followers</title><rect width="100%" height="100%" rx="12" fill="${c.bg}"/><g font-family="Arial,Helvetica,sans-serif">${body}</g></svg>`;
 await mkdir(output,{recursive:true});
 await writeFile(`${output}/github-metrics-${theme}.svg`,svg);
}
console.log(JSON.stringify({updated:snapshot,publicRepositories:repos.length,languages:allLanguages.length,contributionDays:days.length,followersShown:avatars.length}));

'use client';

import { useState } from 'react';

type Page = 'home' | 'import' | 'history' | 'plans' | 'results' | 'users' | 'workshops';

const groups = [
  { title: '排期导入', icon: '⇧', items: [['import', '导入排期'], ['history', '导入记录']] },
  { title: '验货管理', icon: '✓', items: [['plans', '验货计划'], ['results', '验货结果']] },
  { title: '系统设置', icon: '⚙', items: [['users', '用户管理'], ['workshops', '车间与主管']] },
] as const;

const plans = [
  ['2026-09-02','兴信','ZURU','自检','4500211008','1006049180','15783UQ2-SLB-S001','小鸡块系列 6PCS/PDQ/CTN','1,584','264','A车间','张安源','待验货'],
  ['2026-09-03','华登','Sky Castle','客户验货','PO0000131','JAZ288595','SRSM103CDU-24','三代毛绒系列 24PCS/CTN','4,296','179','华登车间','余小兵','日期变更'],
  ['2026-09-04','邵阳','Cepia','第三方','#PO32177','21788','K1002','串装香蕉 6PC CDU','9,600','1,600','B车间','肖晔','待复检'],
  ['2026-09-07','新邵','ZANZOON','自检','PO-26052201','—','3226159','新款五角星-IT','804','134','新邵车间','谭都','已安排'],
  ['2026-09-10','湖南','JAZWARES','第三方','PO0000128','JAZ288592','SRSM103CDU-24','三代系列 24PCS/CTN','4,296','179','湖南车间','关芬乐','待验货'],
];

const titles: Record<Page, string> = { home:'首页', import:'导入排期', history:'导入记录', plans:'验货计划', results:'验货结果', users:'用户管理', workshops:'车间与主管' };
const tag = (value: string) => `tag ${value === '待复检' ? 'purple' : value === '日期变更' ? 'amber' : value === '已完成' ? 'green' : 'blue'}`;

export default function Home() {
  const [page, setPage] = useState<Page>('home');
  const [query, setQuery] = useState('');
  const rows = plans.filter(row => row.join(' ').toLowerCase().includes(query.toLowerCase()));
  return <main className="shell">
    <aside className="side">
      <button className="brand" onClick={() => setPage('home')}><span>QC</span><div><b>QC验货管理</b><small>排期 · 验货 · 结果</small></div></button>
      <button className={`home ${page === 'home' ? 'on' : ''}`} onClick={() => setPage('home')}>⌂　首页</button>
      <nav>{groups.map(group => <section key={group.title}><h3><i>{group.icon}</i>{group.title}</h3>{group.items.map(item => <button className={page === item[0] ? 'on' : ''} onClick={() => setPage(item[0])} key={item[0]}><i />{item[1]}</button>)}</section>)}</nav>
      <div className="profile"><span>管</span><div><b>系统管理员</b><small>admin</small></div><em>•••</em></div>
    </aside>
    <section className="work">
      <header><div><h1>{titles[page]}</h1><small>QC验货管理系统</small></div><div className="top"><label>⌕ <input placeholder="搜索订单、客户或货号" /></label><button>♢<i>5</i></button><span>管</span></div></header>
      <div className="content">
        {page === 'home' && <Dashboard go={setPage} />}
        {page === 'import' && <Import />}
        {page === 'history' && <History />}
        {page === 'plans' && <Plans rows={rows} query={query} setQuery={setQuery} />}
        {page === 'results' && <Results />}
        {page === 'users' && <Users />}
        {page === 'workshops' && <Workshops />}
      </div>
    </section>
  </main>;
}

function Dashboard({go}:{go:(p:Page)=>void}) {
  const cards = [['待验货','36','其中今日 8 单','blue'],['验货期变更','12','需要及时确认','indigo'],['订单信息变更','5','来自本周排期','cyan'],['待复检','3','已生成复检任务','violet']];
  return <><div className="welcome"><div><h2>早上好，管理员</h2><p>这里是本周验货工作的最新情况。</p></div><button className="primary" onClick={()=>go('import')}>＋ 导入本周排期</button></div>
    <div className="alert"><b>!</b><div><strong>本周排期有更新</strong><small>验货期变更 12 单，订单信息变更 5 单，待复检 3 单，请及时处理。</small></div><button onClick={()=>go('history')}>查看变更详情 →</button></div>
    <div className="metrics">{cards.map(c=><button className={c[3]} key={c[0]} onClick={()=>go(c[0] === '订单信息变更' ? 'history' : 'plans')}><small>{c[0]}</small><b>{c[1]}</b><em>{c[2]}</em><i>↗</i></button>)}</div>
    <div className="dashgrid"><Card title="近期验货安排" sub="未来七天需要重点跟进的任务" action="查看全部" onAction={()=>go('plans')}>{plans.slice(0,4).map((r,i)=><div className="schedule" key={r[4]}><span><b>{r[0].slice(-2)}</b><small>9月</small></span><div><b>{r[2]} · {r[7]}</b><small>{r[4]}　{r[1]}</small></div><em className={tag(r[12])}>{r[12]}</em><i>{r[11].slice(-2)}</i></div>)}</Card>
    <Card title="最近动态" sub="排期导入与结果更新">{[['排期导入完成','ZURU排期：新增18单，变更7单','10分钟前'],['验货结果已更新','4500211008 已填写自检结果','32分钟前'],['复检任务已生成','#PO32177 计划于9月4日复检','1小时前'],['车间负责人调整','B车间默认主管已更新','昨天']].map((r,i)=><div className="activity" key={r[0]}><i className={`d${i}`}/><div><b>{r[0]}</b><small>{r[1]}</small></div><time>{r[2]}</time></div>)}</Card></div>
  </>;
}

function Import(){return <div className="narrow"><div className="heading"><h2>导入业务排期</h2><p>上传本周完整最新版排期，系统将在确认后识别新增和变更。</p></div><div className="card import"><div className="steps"><b>1 <small>选择来源</small></b><i/><span>2 <small>上传文件</small></span><i/><span>3 <small>预览确认</small></span><i/><span>4 <small>完成导入</small></span></div><h3>排期来源</h3><div className="sources">{['ZURU','Cepia','Sky Castle','ZANZOON'].map((x,i)=><button className={i===0?'selected':''} key={x}><span>{x.slice(0,2)}</span><b>{x}</b><small>生产排期模板</small></button>)}</div><h3>上传最新版文件</h3><div className="drop"><span>⇧</span><b>拖放排期表到这里，或点击选择文件</b><small>支持 .xlsx / .xls，每次上传该来源的完整最新版</small><button>选择Excel文件</button></div><Tip>系统只更新排期字段，不会覆盖QC结果、生产车间、责任主管、备注和附件。第三方机构来源暂不自动导入。</Tip></div></div>}

function History(){return <List title="导入记录" sub="查看每次完整排期导入后的新增、变更和待确认情况。"><div className="summary">{[['本周导入','3'],['新增计划','39'],['验货期变更','13'],['待确认','4']].map(x=><span key={x[0]}><small>{x[0]}</small><b>{x[1]}</b></span>)}</div><Table heads={['导入时间','排期来源','文件名称','上传人','新增','变更','待确认','状态']} rows={[["2026-08-31 16:42","ZURU","2026年ZURU生产排期.xlsx","业务文员A","18","7","3","已完成"],["2026-08-31 15:18","Cepia","2026年Cepia接单排期表8-29.xls","业务文员B","12","4","0","已完成"],["2026-08-29 11:06","Sky Castle","2026年Sky Castle排期.xlsx","业务文员A","9","2","1","已完成"]]}/></List>}

function Plans({rows,query,setQuery}:{rows:string[][],query:string,setQuery:(x:string)=>void}){return <List title="验货计划" sub="汇总所有未验货且已有计划验货期的订单。" action="＋ 新建临时计划"><div className="change"><b>!</b><span>待处理：</span><button>验货期变更 12 单</button><button>订单信息变更 5 单</button><button>待复检 3 单</button></div><Toolbar query={query} setQuery={setQuery}/><div className="wide"><table><thead><tr>{['验货日期','验货地点','客户名称','验货方','合同编号','客户PO','货号','产品名称','数量','箱数','生产车间','责任主管','状态','操作'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.slice(0,12).map((x,j)=><td className={j===0?'date':j===6?'code strong':j===4||j===5?'code':''} key={j}>{x}</td>)}<td><span className={tag(r[12])}>{r[12]}</span></td><td><button className="link">查看</button>　•••</td></tr>)}</tbody></table></div><div className="pages"><span>共 {rows.length} 条记录</span><div><button>‹</button><button className="on">1</button><button>2</button><button>›</button></div></div></List>}

function Results(){return <List title="验货结果" sub="查看并维护每一次内部、客户、第三方、自检和复检记录。" action="填写验货结果"><Toolbar/><Table heads={['验货日期','客户名称','合同编号','货号','验货类型','验货结果','HOLD/REJ原因','QC负责人','状态']} rows={[["2026-08-31","ZURU","4500207414","157149-S001","自检","PASS","—","张安源","已完成"],["2026-08-31","ZURU","4500203122","15752SLB-S004","第三方","PASS","—","张安源","已完成"],["2026-08-30","Cepia","32131","Z1106","客户验货","HOLD","包装标签待确认","谭都","待复检"],["2026-08-29","Sky Castle","PO0000135-1","SRSM102CDU-16","第三方","PASS","—","余小兵","已完成"]]}/></List>}
function Users(){return <List title="用户管理" sub="管理系统用户、角色以及可查看的数据范围。" action="＋ 新增用户"><Table heads={['姓名','账号','部门','角色','数据范围','状态']} rows={[["张安源","zhangay","QC部","QC主管","全部车间","已完成"],["业务文员A","sales01","业务部","排期文员","ZURU、Sky Castle","已完成"],["谭都","tandu","QC部","QC人员","B车间、新邵","已完成"],["船务接口","shipping_api","船务部","只读账号","已发布结果","已完成"]]}/></List>}
function Workshops(){return <List title="车间与主管" sub="选择车间后，系统自动带出当前默认主管。" action="＋ 新增车间"><Tip>排期重新导入不会覆盖生产车间和责任主管；主管映射调整仅影响新计划。</Tip><Table heads={['生产车间','默认责任主管','验货地点','当前计划数','状态']} rows={[["A车间","张安源","兴信","12","已完成"],["B车间","谭都","兴信","8","已完成"],["华登车间","余小兵","华登","15","已完成"],["新邵车间","肖晔","邵阳","6","已完成"],["湖南车间","关芬乐","湖南","11","已完成"]]}/></List>}

function Card({title,sub,action,onAction,children}:{title:string,sub:string,action?:string,onAction?:()=>void,children:React.ReactNode}){return <section className="card"><div className="cardhead"><div><h3>{title}</h3><small>{sub}</small></div>{action&&<button onClick={onAction}>{action}</button>}</div>{children}</section>}
function List({title,sub,action,children}:{title:string,sub:string,action?:string,children:React.ReactNode}){return <section className="card list"><div className="listhead"><div><h2>{title}</h2><p>{sub}</p></div>{action&&<button className="primary">{action}</button>}</div>{children}</section>}
function Tip({children}:{children:React.ReactNode}){return <div className="tip"><b>映射与导入保护</b><p>{children}</p></div>}
function Toolbar({query='',setQuery}:{query?:string,setQuery?:(x:string)=>void}){return <div className="toolbar"><button>▣　2026-09-01　至　2026-09-30</button><select><option>全部状态</option></select><select><option>全部客户</option></select><select><option>全部车间</option></select><label>⌕ <input value={query} onChange={e=>setQuery?.(e.target.value)} placeholder="搜索合同、PO或货号"/></label><button className="export">导出</button></div>}
function Table({heads,rows}:{heads:string[],rows:string[][]}){return <div className="tablewrap"><table className="simple"><thead><tr>{heads.map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((x,j)=><td key={j}>{j===r.length-1?<span className={tag(x)}>{x}</span>:x}</td>)}</tr>)}</tbody></table></div>}

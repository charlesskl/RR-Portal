"""Render the shipped Jinja pages, then exercise their real JS timer callbacks."""
import json
import os
from datetime import date, datetime
from html.parser import HTMLParser
from pathlib import Path
import shutil
import subprocess
from types import SimpleNamespace
import unittest

from flask import Flask, render_template

APP = Path(__file__).resolve().parents[1]
NODE = os.getenv("QC_UI_NODE_BINARY") or shutil.which("node")


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.elements, self.scripts = {}, []
        self.in_script = False
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            self.elements[attrs["id"]] = attrs
        if "data-import-status" in attrs:
            self.elements["processing"] = attrs
        if tag == "script" and "src" not in attrs:
            self.in_script = True
            self.scripts.append("")

    def handle_endtag(self, tag):
        if tag == "script":
            self.in_script = False

    def handle_data(self, text):
        if self.in_script:
            self.scripts[-1] += text


NODE_RUNNER = r"""
const assert = require('node:assert/strict');
const vm = require('node:vm');
let input = ''; process.stdin.on('data', value => input += value);
process.stdin.on('end', async () => {
  const data = JSON.parse(input), timers = [], calls = [], states = [...data.states];
  let reloads = 0;
  const title = {textContent:''}, detail = {textContent:''};
  const section = {dataset: data.dataset, querySelector: sel => sel === 'h2' ? title : detail};
  const message = {className:'', innerHTML:'', textContent:''};
  const button = {disabled:data.disabled, listeners:{}, addEventListener(name, fn) {this.listeners[name] = fn;}};
  const selectors = {'.ai-review-section':section, '#start-ai-analysis':button, '#analysis-message':message, '[data-import-status]':section};
  const window = {setTimeout:(fn, delay) => {timers.push({fn,delay});}, addEventListener:()=>{}, CSRF_TOKEN:'synthetic', QCUrls:{analysisStatusUrl:(base,id)=>base+id}, location:{reload:()=>reloads++}};
  const context = {window, document:{querySelector:sel=>selectors[sel] || null, querySelectorAll:()=>[]}, navigator:{onLine:false}, location:window.location, setTimeout:window.setTimeout,
    fetch:async (url, options={}) => {
      calls.push({url,method:options.method || 'GET'});
      if (options.method === 'POST') return {ok:true,json:async()=>({analysis_run_id:9,status:'queued'})};
      assert.ok(states.length, 'Unexpected extra status request');
      const status = states.shift();
      if (status === 'network-error') throw new Error('synthetic offline');
      return {ok:true,json:async()=>({status})};
    }};
  vm.runInNewContext(data.source, context);
  if (data.kind === 'analysis') {
    if (data.start) {
      await Promise.all([button.listeners.click(), button.listeners.click()]);
      assert.equal(calls.filter(c=>c.method==='POST').length,1,'Rapid repeated start must enqueue once');
    } else {
      assert.ok(button.disabled,'Active task must disable duplicate start');
      await button.listeners.click();
      assert.equal(calls.filter(c=>c.method==='POST').length,0,'Active task must not start another run');
    }
  }
  assert.equal(timers.length,1,'An active task must start polling');
  for (const expected of data.states) {
    const timer = timers.shift(); assert.ok(timer);
    await timer.fn();
    if (['completed','failed','needs_review'].includes(expected)) {
      assert.equal(reloads,1,'Terminal status must refresh the rendered result');
      assert.equal(timers.length,0,'Terminal status must stop polling');
    } else {
      assert.equal(reloads,0,'An active/retrying or unreachable task must remain pending');
      assert.equal(timers.length,1,'Active task must continue polling');
      if (expected === 'retrying') {
        const text = data.kind === 'analysis' ? message.innerHTML+message.textContent : title.textContent+detail.textContent;
        assert.ok(text.includes('等待重试'),'Retrying must be distinguishable from a completed draft');
        if (data.kind === 'analysis') assert.ok(button.disabled);
      }
    }
  }
  assert.equal(calls.filter(c=>c.method==='GET').length,data.states.length);
  process.stdout.write(JSON.stringify({success:true,requests:calls.length,reloads}));
});
"""


class RetryUIContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not NODE:
            raise RuntimeError("Node is required for the shipped polling JavaScript")
        cls.app = Flask(__name__, template_folder=str(APP / "templates"), static_folder=str(APP / "static"))
        cls.app.secret_key = "synthetic-ui-only"
        routes = {
            "new_report":"/reports/new", "new_manual_report":"/reports/manual",
            "po_import_source":"/po-imports/<int:import_id>/source", "api_get_po_import":"/api/po-imports/<int:import_id>",
            "po_import_detail":"/po-imports/<int:import_id>", "preview_report":"/reports/<int:report_id>/preview",
            "report_detail":"/reports/<int:report_id>", "start_analysis_run":"/api/reports/<int:report_id>/analysis-runs",
            "get_analysis_run":"/api/analysis-runs/<int:run_id>", "save_signature":"/reports/<int:report_id>/signature",
            "finalize_report":"/reports/<int:report_id>/finalize",
        }
        for endpoint, path in routes.items():
            cls.app.add_url_rule(path, endpoint, lambda **kwargs: "unused synthetic route")

    def render(self, template, **context):
        with self.app.test_request_context("/", environ_overrides={"SCRIPT_NAME":"/qc-report"}):
            return render_template(template, current_user=lambda:None, csrf_token=lambda:"synthetic", **context)

    def analysis(self, status):
        report = SimpleNamespace(id=1,report_no="synthetic",revision=0,result="ON HOLD",result_reason="",critical_count=0,major_count=0,minor_count=0,sample_size=1,inspection_date=date(2026,10,21),inspected_qty=1,critical_aql=0,major_aql=1,minor_aql=4,remarks="",manual_hold=False,hold_reason="",signature_path="")
        run = SimpleNamespace(id=7,status=status,error_message="synthetic failure",model="synthetic",completed_at=None,request_id="")
        html = self.render("ai_inspection.html",report=report,snapshot={},required_done=1,required_total=1,latest_run=run,slots=[],packing={},photos_by_slot={},tests=[],observations=[],findings=[])
        return html, Page(html)

    def javascript(self, kind, page, states, *, start=False):
        attrs = page.elements["processing" if kind == "po" else "ai-review"]
        dataset = {"statusUrl":attrs.get("data-status-url"),"runStatus":attrs.get("data-run-status"),"runUrl":attrs.get("data-run-url"),"statusBase":attrs.get("data-status-base"),"importStatus":attrs.get("data-import-status")}
        source = page.scripts[-1] if kind == "po" else (APP / "static/ai_inspection.js").read_text()
        result = subprocess.run([NODE,"-e",NODE_RUNNER],input=json.dumps({"kind":kind,"source":source,"dataset":dataset,"disabled":"disabled" in page.elements.get("start-ai-analysis",{}),"states":states,"start":start}),text=True,capture_output=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertTrue(json.loads(result.stdout)["success"])

    def test_po_retrying_is_pending_and_all_active_states_poll_until_terminal(self):
        for status in ("queued","processing","retrying"):
            for terminal in ("needs_review","failed"):
                with self.subTest(status=status,terminal=terminal):
                    html = self.render("po_review.html",po_import=SimpleNamespace(id=5,status=status,original_name="synthetic.pdf",error_message=""),items=[])
                    self.assertIn('data-import-status="'+status+'"',html)
                    self.assertNotIn("没有识别到货号",html)
                    if status == "retrying":
                        self.assertIn("等待重试",html)
                    self.javascript("po",Page(html),["retrying","network-error","processing",terminal])

    def test_analysis_retrying_disables_start_and_all_active_states_keep_polling(self):
        for status in ("queued","processing","retrying"):
            for terminal in ("completed","failed"):
                with self.subTest(status=status,terminal=terminal):
                    html,page = self.analysis(status)
                    self.assertIn("disabled",page.elements["start-ai-analysis"])
                    self.assertNotIn("分析已返回草稿",html)
                    if status == "retrying":
                        self.assertIn("等待重试",html)
                    self.javascript("analysis",page,["retrying","network-error","processing",terminal])

    def test_completed_and_failed_analysis_allow_one_new_start_then_poll(self):
        for status in ("completed","failed"):
            with self.subTest(status=status):
                _,page = self.analysis(status)
                self.assertNotIn("disabled",page.elements["start-ai-analysis"])
                self.javascript("analysis",page,["retrying","completed"],start=True)

    def test_recent_imports_label_retrying_without_displaying_a_false_failure_cause(self):
        row=SimpleNamespace(id=5,status="retrying",original_name="synthetic.pdf",created_at=datetime(2026,10,21),checksum="0"*64)
        html=self.render("new_report.html",imports=[row])
        self.assertIn("等待重试",html)
        self.assertNotIn('>retrying<',html)
        self.assertNotIn("额度",html)
        self.assertNotIn("频率",html)


if __name__ == "__main__":
    unittest.main()

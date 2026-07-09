"""LangGraph 管线主文件：组装5个节点并执行。"""

from langgraph.graph import StateGraph, END
from .nodes import ParserState, node_extract, node_classify, node_ai_extract, node_normalize, node_finalize


def build_graph():
    graph = StateGraph(ParserState)

    graph.add_node('extract', node_extract)
    graph.add_node('classify', node_classify)
    graph.add_node('ai_extract', node_ai_extract)
    graph.add_node('normalize', node_normalize)
    graph.add_node('finalize', node_finalize)

    graph.set_entry_point('extract')
    graph.add_edge('extract', 'classify')
    graph.add_edge('classify', 'ai_extract')

    # Node3 失败时跳过 normalize，直接 finalize
    graph.add_conditional_edges(
        'ai_extract',
        lambda s: 'normalize' if not (s.ai_error if hasattr(s, 'ai_error') else s.get('ai_error', '')) else 'finalize',
        {'normalize': 'normalize', 'finalize': 'finalize'}
    )
    graph.add_edge('normalize', 'finalize')
    graph.add_edge('finalize', END)

    return graph.compile()


def run_ai_parser(eml_data: dict, attachments: list) -> dict:
    """执行 AI 解析管线，返回前端审核所需的结果。"""
    app = build_graph()
    initial_state = ParserState(eml_data=eml_data, attachments=attachments)
    final_state = app.invoke(initial_state)
    # LangGraph 返回 dict，兼容 ParserState 对象两种情况
    if isinstance(final_state, dict):
        return final_state.get('final', {})
    return final_state.final

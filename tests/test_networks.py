import pytest
from backend.models import Project
from backend.graph import apply_commands,GraphError,require_valid
from backend.runtime import evaluate

def test_nested_channels_cook_and_scope_edits_are_atomic():
    p=Project(id='root',name='Nested')
    p=apply_commands(p,[{'op':'add_node','id':'component','type':'base_comp'},
        {'op':'add_node','type':'constant','id':'constant','params':{'value':4},'scope':['component']},
        {'op':'add_node','type':'network_out_chop','id':'out','scope':['component']},
        {'op':'connect','source':'constant','target':'out','scope':['component']},
        {'op':'add_node','type':'math','id':'math','params':{'value':2}},
        {'op':'connect','source':'component','target':'math'}])
    result=evaluate(p)
    assert result['errors']=={}
    assert result['values']['component/constant']==4
    assert result['values']['math']==8
    before=p.model_dump()
    with pytest.raises(GraphError):apply_commands(p,[{'op':'set_param','id':'constant','key':'value','value':10,'scope':['component']},{'op':'remove_node','id':'missing'}])
    assert p.model_dump()==before

def test_child_validation_and_parent_port_routing():
    p=apply_commands(Project(id='root',name='Ports'),[{'op':'add_node','id':'source','type':'constant','params':{'value':12}},{'op':'add_node','id':'component','type':'base_comp'},
        {'op':'add_node','id':'in','type':'network_in_chop','scope':['component']},{'op':'add_node','id':'out','type':'network_out_chop','scope':['component']},
        {'op':'connect','source':'in','target':'out','scope':['component']},{'op':'connect','source':'source','target':'component'}])
    assert evaluate(p)['values']['component']==12
    p.nodes[1].data.graph.nodes[0].type='missing_operator'
    with pytest.raises(GraphError,match='component/'):require_valid(p)

def test_typed_channels_to_existing_scalar_math():
    p=apply_commands(Project(id='root',name='Types'),[{'op':'add_node','id':'signal','type':'channel_constant','params':{'values':'{"x":[1,2,3]}'}},{'op':'add_node','id':'math','type':'math','params':{'value':4}},{'op':'connect','source':'signal','target':'math'}])
    result=evaluate(p)
    assert not result['errors']
    assert result['values']['math']==12

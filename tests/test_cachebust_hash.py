import sys, os, traceback
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))
from cachebust_hash import stamp, effective_hash


def test_html_token_is_referenced_file_hash():
    files = {
        'js/leaf.js': 'export const x = 1;\n',
        'app.html': '<script>s.src="./js/leaf.js?v=OLD"</script>',
    }
    out = stamp(files)
    h = effective_hash('js/leaf.js', files)
    assert f'./js/leaf.js?v={h}' in out['app.html'], out['app.html']


def test_import_token_is_dep_hash_and_bumps_when_dep_changes():
    files = {
        'js/config.js': 'export const A = 1;\n',
        'js/app.js': "import { A } from './config.js?v=OLD';\n",
        'app.html': '<script>s.src="./js/app.js?v=OLD"</script>',
    }
    out = stamp(files)
    ch = effective_hash('js/config.js', files)
    assert f"'./config.js?v={ch}'" in out['js/app.js'], out['js/app.js']
    ah = effective_hash('js/app.js', files)
    assert f'./js/app.js?v={ah}' in out['app.html'], out['app.html']
    files2 = dict(files); files2['js/config.js'] = 'export const A = 2;\n'
    assert effective_hash('js/app.js', files2) != ah  # dep changed -> dependent bumps


def test_unrelated_change_does_not_bump_token():
    files = {
        'js/a.js': 'export const A = 1;\n',
        'js/b.js': 'export const B = 1;\n',
        'a.html': '<script>s.src="./js/a.js?v=OLD"</script>',
    }
    h_a = effective_hash('js/a.js', files)
    files2 = dict(files); files2['js/b.js'] = 'export const B = 2;\n'  # unrelated
    assert effective_hash('js/a.js', files2) == h_a  # no false nag


def test_stamp_is_idempotent():
    files = {
        'js/config.js': 'export const A = 1;\n',
        'js/app.js': "import { A } from './config.js?v=OLD';\n",
        'app.html': '<script>s.src="./js/app.js?v=OLD"</script>',
    }
    once = stamp(files)
    twice = stamp(once)
    assert once == twice


def test_cycle_terminates():
    files = {
        'js/a.js': "import { B } from './b.js?v=X';\nexport const A = 1;\n",
        'js/b.js': "import { A } from './a.js?v=X';\nexport const B = 1;\n",
    }
    out = stamp(files)  # must not infinite-loop
    assert './b.js?v=' in out['js/a.js'] and './a.js?v=' in out['js/b.js']


def test_css_ref_is_content_hashed():
    files = {
        'css/reader.css': 'body{color:red}\n',
        'app.html': '<link href="./css/reader.css?v=OLD">',
    }
    out = stamp(files)
    h = effective_hash('css/reader.css', files)
    assert f'./css/reader.css?v={h}' in out['app.html'], out['app.html']


if __name__ == '__main__':
    fns = [v for k, v in sorted(globals().items()) if k.startswith('test_')]
    fails = 0
    for fn in fns:
        try:
            fn(); print('PASS', fn.__name__)
        except Exception as e:
            fails += 1; print('FAIL', fn.__name__, '->', repr(e)); traceback.print_exc()
    print(f'\n{len(fns)-fails}/{len(fns)} passed')
    sys.exit(1 if fails else 0)

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re


def substitution_end(command, start, backticks):
    quote, depth, index = None, 1, start
    while index < len(command):
        character = command[index]
        if character == '\\' and quote != "'":
            index += 1
        elif quote:
            if character == quote:
                quote = None
        elif character in "'\"":
            quote = character
        elif backticks and character == '`':
            return index
        elif not backticks and character == '(':
            depth += 1
        elif not backticks and character == ')':
            depth -= 1
            if depth == 0:
                return index
        index += 1
    return -1


def shell_commands(command):
    commands, words, pending, issues = [], [], [], []
    word, started, quote, delimiter = '', False, None, None
    quoted_word = False
    index = 0
    while index < len(command):
        character = command[index]
        if character == '\\' and quote != "'":
            if index + 1 < len(command):
                index += 1
                quoted_word = True
                if command[index] != '\n':
                    word += command[index]
                    started = True
        elif quote != "'" and ((character == '$' and command[index + 1:index + 2] == '(') or character == '`'):
            start = index + (1 if character == '`' else 2)
            end = substitution_end(command, start, character == '`')
            if end < 0:
                return commands, False, issues + ['Unclosed active command substitution']
            nested_commands, nested_complete, nested_issues = shell_commands(command[start:end])
            commands.extend(nested_commands)
            issues.extend(nested_issues)
            if not nested_complete:
                issues.append('Unsupported active command substitution')
            word += '$DYNAMIC'
            started = True
            index = end
        elif quote:
            if character == quote:
                quote = None
            else:
                word += character
        elif character in "'\"":
            quote, started, quoted_word = character, True, True
        elif character == '#' and not started:
            newline = command.find('\n', index)
            index = len(command) if newline < 0 else newline - 1
        elif character == '<' and command[index:index + 2] == '<<':
            if started:
                words.append(word)
                word, started, quoted_word = '', False, False
            index += 1
            delimiter = command[index + 1:index + 2] == '-'
            if delimiter:
                index += 1
        elif character in '<>':
            if started:
                words.append(word)
                word, started, quoted_word = '', False, False
            words.append(character)
        elif character in ';|&()\n' or character.isspace():
            if started:
                if delimiter is not None:
                    pending.append((word, delimiter, quoted_word))
                    delimiter = None
                else:
                    words.append(word)
                word, started, quoted_word = '', False, False
            if character in ';|&()\n':
                if words:
                    commands.append(words)
                words = []
                if character == '\n' and pending:
                    for marker, strip_tabs, quoted in pending:
                        matched = False
                        while index < len(command):
                            end = command.find('\n', index + 1)
                            line = command[index + 1:len(command) if end < 0 else end]
                            index = len(command) if end < 0 else end
                            if not quoted:
                                cursor = 0
                                while cursor < len(line):
                                    if line[cursor] == '\\':
                                        cursor += 1
                                    elif line[cursor] == '`' or line[cursor:cursor + 2] == '$(':
                                        issues.append('Active substitution in an unquoted heredoc requires independent visibility review')
                                    cursor += 1
                            if (line.lstrip('\t') if strip_tabs else line) == marker:
                                matched = True
                                break
                        if not matched:
                            return commands, False, issues
                    pending = []
        else:
            word += character
            started = True
        index += 1
    if started:
        if delimiter is not None:
            pending.append((word, delimiter, quoted_word))
            delimiter = None
        else:
            words.append(word)
    if words:
        commands.append(words)
    return commands, quote is None and delimiter is None and not pending, issues


def script_visibility(command, message):
    if not isinstance(command, str) or not isinstance(message, str):
        return {'paths': [], 'issues': []}
    commands, complete, issues = shell_commands(command)
    paths = []
    for words in commands:
        index = 0
        while index < len(words) and re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', words[index]):
            index += 1
        executable = words[index] if index < len(words) else ''
        if re.search(r'[$`]', executable):
            issues.append('Dynamic executable requires independent visibility review')
        if re.fullmatch(r'(?:if|then|elif|while|until|do|for|case|!)', executable) and any(re.search(r'\.(?:sh|py|js)$', word) for word in words[index + 1:]):
            issues.append('Unsupported script invocation inside shell control flow')
        if re.fullmatch(r'(?:env|sudo|timeout|nice|command|exec|nohup)', executable.rsplit('/', 1)[-1]) and any(re.search(r'\.(?:sh|py|js)$', word) for word in words[index + 1:]):
            issues.append(f'Unsupported script execution wrapper {executable}')
        interpreter = bool(re.fullmatch(r'(?:bash|sh|python3?|node)', executable.rsplit('/', 1)[-1]))
        if interpreter and index + 1 < len(words) and words[index + 1].startswith('-') and any(re.search(r'\.(?:sh|py|js)(?:\s|$)', word) for word in words[index + 2:]):
            issues.append(f'Unsupported script interpreter options {executable}')
        first = words[index + 1] if index + 1 < len(words) else ''
        candidate = (words[index + 2] if index + 2 < len(words) else '') if interpreter and first == '<' else first if interpreter else executable
        if interpreter and re.search(r'[$`]', candidate):
            issues.append(f'Dynamic script path requires independent visibility review {executable}')
        if not re.search(r'\.(?:sh|py|js)$', candidate) or re.search(r'[$`<>\n]', candidate):
            continue
        if (interpreter or '/' in candidate) and candidate not in paths:
            paths.append(candidate)
    text = message.replace('\\n', '\n')
    bodies = []
    end = 0
    for match in re.finditer(r'(^|\n)[ \t]*```([^\n]*)\n([\s\S]*?)\n[ \t]*```', text):
        bodies.append((text[end:match.start()], match[3], match[2].strip()))
        end = match.end()
    if not bodies:
        match = re.search(r'(^|\n)[ \t]*(#![^\n]+\n[\s\S]*)', text)
        if match:
            bodies.append((text[:match.start()], match[2], 'shebang'))
    if paths and not complete:
        issues.append('Unsupported or incomplete shell structure around a script invocation')
    for script in paths:
        matching = []
        for prefix, contents, language in bodies:
            names = [next(value for value in match.groups() if value is not None) for match in re.finditer(r'''`([^`\n]+\.(?:sh|py|js))`|"([^"\n]+\.(?:sh|py|js))"|'([^'\n]+\.(?:sh|py|js))'|([^\s`"'<>():,]+\.(?:sh|py|js))\b''', prefix)]
            name = names[-1] if names else None
            attributed = name == script or ('/' not in name and name == script.rsplit('/', 1)[-1] and sum(item.rsplit('/', 1)[-1] == name for item in paths) == 1) if name else len(paths) == 1 and len(bodies) == 1
            if attributed:
                matching.append((contents, language))
        if len(matching) != 1:
            issues.append(f'Missing or ambiguous visible contents for invoked script {script}')
            continue
        contents, language = matching[0]
        executable = [line for line in contents.split('\n') if line.strip() and not re.match(r'^\s*(?:#|//)', line)]
        if not executable or (not language and not re.match(r'^\s*#!', contents)) or not re.fullmatch(r'(?:shebang|sh|bash|shell|zsh|python|python3|py|javascript|js|node)?', language) or re.search(r'(?:^\s*(?:\.{3}|…)\s*$|\b(?:omitted|truncated|redacted|placeholder)\b)', contents, re.I | re.M):
            issues.append(f'Missing executable or complete visible contents for invoked script {script}')
    return {'paths': paths, 'issues': issues}


def digest(value):
    if not isinstance(value, str):
        value = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    return hashlib.sha256(value.encode()).hexdigest()


def audit(directory):
    directory = Path(directory)
    contents = (directory / 'proposals.jsonl').read_text()
    manifest = json.loads((directory / 'manifest.json').read_text())
    packet = json.loads((directory / 'review-packet.json').read_text())
    rows = [json.loads(line) for line in contents.splitlines() if line]
    requests = packet['requests']
    if not rows or len(rows) != len(requests) or manifest['cases'] != len(rows):
        raise ValueError('Missing or inconsistent proposal and request counts')
    if manifest['proposalsSha256'] != digest(contents):
        raise ValueError('Frozen proposals changed')
    if manifest['requestsSha256'] != digest(requests):
        raise ValueError('Frozen review requests changed')
    families = {}
    identifiers = set()
    inputs = set()
    split_counts = Counter()
    tool_counts = Counter()
    features = Counter()
    for row, request in zip(rows, requests):
        if row['id'] in identifiers or request['id'] != row['id']:
            raise ValueError('Duplicated or mismatched case identity')
        identifiers.add(row['id'])
        if row['split'] not in ('train', 'validation', 'test'):
            raise ValueError('Unknown data split')
        if row['family'] in families and families[row['family']] != row['split']:
            raise ValueError('A scenario family crosses data splits')
        families[row['family']] = row['split']
        if row.get('trainingEligible') is not False:
            raise ValueError('Unqualified authored data cannot claim training eligibility')
        if request.get('version') != '3':
            raise ValueError('Historical request format is not current V3 data')
        exact = {key: request[key] for key in ('version', 'query', 'tools')}
        if request['inputHash'] != digest(exact) or request['inputHash'] in inputs:
            raise ValueError('Changed or duplicated production input')
        inputs.add(request['inputHash'])
        if [tool['name'] for tool in request['tools']] != ['approve', 'deny', 'ask']:
            raise ValueError('The three current direct verdict tools are required')
        prefix = 'Folder Preference:\n' + row['preference']['text'] + '\n\nUser request: ' + row['userMessage'] + '. Agent action: ' + row['tool'] + ' '
        if not request['query'].startswith(prefix):
            raise ValueError('The complete authored input is absent from the production request')
        action, end = json.JSONDecoder().raw_decode(request['query'][len(prefix):])
        if action != row['args'] or not request['query'][len(prefix) + end:].startswith('. Effects: '):
            raise ValueError('The complete action arguments are absent from the production request')
        split_counts[row['split']] += 1
        tool_counts[row['agent'] + ':' + row['tool']] += 1
        command = row['args'].get('command', row['args'].get('cmd', '')) if isinstance(row['args'], dict) else ''
        if isinstance(command, list):
            command = '\n'.join(command)
        if isinstance(command, str) and command:
            features['shellCalls'] += 1
            features['multiline'] += '\n' in command
            features['variables'] += bool(re.search(r'\$[A-Za-z_{]', command))
            features['commandSubstitution'] += '$(' in command or '`' in command
            features['heredocs'] += '<<' in command
            scripts = script_visibility(command, row['userMessage'])
            if scripts['issues']:
                raise ValueError(row['id'] + ': ' + '; '.join(scripts['issues']))
            features['scriptInvocation'] += bool(scripts['paths'])
    return {
        'status': 'complete-integrity-check',
        'cases': len(rows),
        'families': len(families),
        'splits': dict(split_counts),
        'tools': dict(tool_counts),
        'shellFeatures': dict(features),
        'proposalsSha256': digest(contents),
        'requestsSha256': digest(requests),
        'generatedCommandsExecuted': False,
        'trainingEligible': False,
        'humanVerified': False,
        'modelQualityMeasured': False,
        'scope': 'Frozen input integrity and visible request checks only. No schema, label, tokenizer, runtime interception, or model qualification is implied.',
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('new_report', type=Path)
    args = parser.parse_args()
    if args.new_report.exists():
        raise FileExistsError('Preserve existing audit reports; choose a new output')
    report = audit(args.directory)
    with args.new_report.open('x') as output:
        output.write(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))

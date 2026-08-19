# The resolver, against the repo's real listing.
FILES = [
 'BF16/Qwen3.8-27B-BF16-00001-of-00002.gguf','MTP/mtp-Qwen3.8-27B-Q4_0.gguf',
 'Qwen3.8-27B-Q4_0.gguf','Qwen3.8-27B-Q4_1.gguf','Qwen3.8-27B-Q8_0.gguf',
 'Qwen3.8-27B-UD-IQ1_M.gguf','Qwen3.8-27B-UD-IQ2_S.gguf','Qwen3.8-27B-UD-IQ4_XS.gguf',
 'Qwen3.8-27B-UD-Q2_K_XL.gguf','Qwen3.8-27B-UD-Q3_K_XL.gguf','Qwen3.8-27B-UD-Q4_K_M.gguf',
 'Qwen3.8-27B-UD-Q4_K_S.gguf','Qwen3.8-27B-UD-Q5_K_M.gguf','Qwen3.8-27B-UD-Q5_K_S.gguf',
 'Qwen3.8-27B-UD-Q6_K.gguf','Qwen3.8-27B-UD-Q8_K_XL.gguf','mmproj-F16.gguf']
MODEL_REPO = 'unsloth/Qwen3.8-27B-GGUF'

def pick(quant, files=FILES):
    base = MODEL_REPO.split('/')[-1].replace('-GGUF','')
    for c in (f'{base}-{quant}.gguf', f'{base}-UD-{quant}.gguf'):
        if c in files: return c
    loose = [f for f in files if quant in f and '/' not in f]
    return loose[0] if loose else None

cases = [('Q5_K_M','Qwen3.8-27B-UD-Q5_K_M.gguf'),   # the one that 404'd
         ('Q4_K_M','Qwen3.8-27B-UD-Q4_K_M.gguf'),
         ('Q8_0',  'Qwen3.8-27B-Q8_0.gguf'),         # plain exists, must win
         ('Q5_K_S','Qwen3.8-27B-UD-Q5_K_S.gguf'),
         ('Q3_K_M', None)]                            # genuinely absent now
bad = 0
for q, want in cases:
    got = pick(q)
    ok = got == want
    if not ok: bad += 1
    print(('  PASS  ' if ok else '  FAIL  ') + f'{q:<8} -> {got}' + ('' if ok else f'  (want {want})'))
print('\n' + ('PICK LOGIC PASSES' if not bad else f'FAILED ({bad})'))

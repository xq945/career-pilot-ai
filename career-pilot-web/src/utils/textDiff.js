/**
 * 行级文本差异（M13 版本对比用：前端本地实现，不新增依赖）。
 *
 * 算法：LCS 动态规划——先求两文本最长公共子序列长度表，再回溯生成行级
 * diff 序列（same / del / add）。文本规模为优化稿量级（最长 8000 字符 ≈ 数百行），
 * O(n×m) 在本场景实测毫秒级。
 */

/**
 * @param {string} oldText 对比基准（如所选历史版本全文）
 * @param {string} newText 对照文本（如当前稿全文）
 * @returns {Array<{ type: 'same' | 'del' | 'add', text: string }>}
 *   del = 仅存在于旧文本的行、add = 仅存在于新文本的行
 */
export function diffLines(oldText, newText) {
  const a = String(oldText ?? '').split('\n')
  const b = String(newText ?? '').split('\n')
  const n = a.length
  const m = b.length

  // dp[i][j] = a[i..] 与 b[j..] 的最长公共子序列长度
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const result = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ type: 'same', text: a[i] })
      i += 1
      j += 1
    }
    else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: 'del', text: a[i] })
      i += 1
    }
    else {
      result.push({ type: 'add', text: b[j] })
      j += 1
    }
  }
  while (i < n) {
    result.push({ type: 'del', text: a[i] })
    i += 1
  }
  while (j < m) {
    result.push({ type: 'add', text: b[j] })
    j += 1
  }
  return result
}

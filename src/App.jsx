import { useState, useEffect, useCallback } from 'react'
import { Search, Star, GitFork, ExternalLink, TrendingUp, Calendar, Filter, FileText, ChevronDown, ChevronUp, AlertCircle, Key } from 'lucide-react'

// Simple delay utility
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Cache utilities
const getCache = (key) => {
  try {
    const cached = localStorage.getItem(`github-trends-${key}`)
    if (!cached) return null
    const { data, timestamp } = JSON.parse(cached)
    // Cache expires after 5 minutes
    if (Date.now() - timestamp > 5 * 60 * 1000) {
      localStorage.removeItem(`github-trends-${key}`)
      return null
    }
    return data
  } catch {
    return null
  }
}

const setCache = (key, data) => {
  try {
    localStorage.setItem(`github-trends-${key}`, JSON.stringify({ data, timestamp: Date.now() }))
  } catch {
    // Ignore cache errors
  }
}

function App() {
  const [repositories, setRepositories] = useState([])
  const [repoDetails, setRepoDetails] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [rateLimited, setRateLimited] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [languageFilter, setLanguageFilter] = useState('')
  const [timeRange, setTimeRange] = useState('daily')
  const [expandedRepo, setExpandedRepo] = useState(null)
  const [githubToken, setGithubToken] = useState(import.meta.env.VITE_GITHUB_TOKEN || '')
  const [showTokenInput, setShowTokenInput] = useState(false)

  // Save token to localStorage when changed
  useEffect(() => {
    if (githubToken) {
      localStorage.setItem('github-token', githubToken)
    } else {
      localStorage.removeItem('github-token')
    }
  }, [githubToken])

  // Get headers with optional auth token
  const getHeaders = () => {
    const headers = {
      'Accept': 'application/vnd.github.v3+json'
    }
    if (githubToken) {
      headers['Authorization'] = `token ${githubToken}`
    }
    return headers
  }
  const fetchReadme = async (owner, repo) => {
    // Check cache first
    const cacheKey = `readme-${owner}-${repo}`
    const cached = getCache(cacheKey)
    if (cached) return cached
    
    try {
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/readme`,
        { headers: getHeaders() }
      )
      
      if (response.status === 403 || response.status === 429) {
        setRateLimited(true)
        return null
      }
      
      if (!response.ok) {
        return null
      }
      
      const data = await response.json()
      const decoded = atob(data.content.replace(/\n/g, ''))
      setCache(cacheKey, decoded)
      return decoded
    } catch {
      return null
    }
  }

  // Fetch repo info with rate limit handling
  const fetchRepoInfo = async (owner, repo) => {
    // Check cache first
    const cacheKey = `info-${owner}-${repo}`
    const cached = getCache(cacheKey)
    if (cached) return cached
    
    try {
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}`,
        { headers: getHeaders() }
      )
      
      if (response.status === 403 || response.status === 429) {
        setRateLimited(true)
        return null
      }
      
      if (!response.ok) {
        return null
      }
      
      const data = await response.json()
      setCache(cacheKey, data)
      return data
    } catch {
      return null
    }
  }

  // Extract meaningful description from README
  const extractDescription = (readme, existingDescription) => {
    if (!readme) return existingDescription || 'No description available'
    
    // Remove HTML tags first
    let cleanText = readme
      .replace(/<[^>]*>/g, ' ') // Remove HTML tags
      .replace(/#+ /g, '') // Remove markdown headers
      .replace(/\*\*/g, '') // Remove bold
      .replace(/\*/g, '') // Remove italic
      .replace(/`/g, '') // Remove code
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Replace links with just text
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '') // Remove images
      .replace(/\n+/g, ' ') // Replace newlines with spaces
      .replace(/\s+/g, ' ') // Collapse multiple spaces
      .trim()
    
    // Get first 1-2 sentences (up to 200 chars)
    const sentences = cleanText.split(/[.!?]+/)
    let desc = ''
    for (let sentence of sentences) {
      sentence = sentence.trim()
      if (sentence.length > 20 && !sentence.includes('==') && !sentence.includes('---')) {
        desc += sentence + '. '
        if (desc.length > 200) break
      }
    }
    
    desc = desc.trim()
    
    // If README extraction is too short or empty, fall back to existing description
    if (desc.length < 30 && existingDescription) {
      return existingDescription
    }
    
    return desc || existingDescription || 'No description available'
  }

  // Get repo details with sequential fetching to avoid rate limits
  const fetchRepoDetailsWithDelay = async (owner, repo, delayMs = 0) => {
    if (delayMs > 0) {
      await delay(delayMs)
    }
    
    try {
      const readme = await fetchReadme(owner, repo)
      const repoInfo = await fetchRepoInfo(owner, repo)
      
      const enhancedDesc = extractDescription(readme, repoInfo?.description)
      
      return {
        enhancedDescription: enhancedDesc,
        topics: repoInfo?.topics || [],
        readmeAvailable: !!readme
      }
    } catch {
      return {
        enhancedDescription: 'No description available',
        topics: [],
        readmeAvailable: false
      }
    }
  }

  const fetchTrendingRepos = useCallback(async () => {
    setLoading(true)
    setError(null)
    setRateLimited(false)
    
    try {
      const date = new Date()
      let dateString
      
      switch (timeRange) {
        case 'daily':
          date.setDate(date.getDate() - 1)
          break
        case 'weekly':
          date.setDate(date.getDate() - 7)
          break
        case 'monthly':
          date.setMonth(date.getMonth() - 1)
          break
        default:
          date.setDate(date.getDate() - 1)
      }
      
      dateString = date.toISOString().split('T')[0]
      
      let query = `created:>${dateString}`
      if (languageFilter) {
        query += `+language:${languageFilter}`
      }
      
      const response = await fetch(
        `https://api.github.com/search/repositories?q=${query}&sort=stars&order=desc&per_page=30`,
        { headers: getHeaders() }
      )
      
      if (response.status === 403 || response.status === 429) {
        setRateLimited(true)
        if (!githubToken) {
          throw new Error('GitHub API rate limit exceeded. Add a token for 5000 requests/hour, or wait 1 minute.')
        }
        throw new Error('GitHub API rate limit exceeded. Please wait a minute and try again.')
      }
      
      if (!response.ok) {
        throw new Error('Failed to fetch repositories')
      }
      
      const data = await response.json()
      const repos = data.items || []
      setRepositories(repos)
      
      // Fetch enhanced details sequentially with delays to avoid rate limits
      const details = {}
      const topRepos = repos.slice(0, 6) // Reduced to 6 to minimize API calls
      
      for (let i = 0; i < topRepos.length; i++) {
        const repo = topRepos[i]
        const repoDetail = await fetchRepoDetailsWithDelay(
          repo.owner.login, 
          repo.name, 
          i * 100 // 100ms delay between each request
        )
        details[repo.id] = repoDetail
      }
      
      setRepoDetails(details)
      
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [timeRange, languageFilter])

  useEffect(() => {
    fetchTrendingRepos()
  }, [fetchTrendingRepos])

  const getDescription = (repo) => {
    const details = repoDetails[repo.id]
    if (details?.enhancedDescription) {
      return details.enhancedDescription
    }
    return repo.description || 'No description available'
  }

  const filteredRepos = repositories.filter(repo => 
    repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (repo.description && repo.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
    repo.owner.login.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const formatNumber = (num) => {
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'k'
    }
    return num.toString()
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-700 bg-slate-800/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg">
                <TrendingUp className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                  GitHub Trends
                </h1>
                <p className="text-xs text-slate-400">Discover trending repositories</p>
              </div>
            </div>
            
            {/* Search Bar */}
            <div className="flex items-center gap-2">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
                <input
                  type="text"
                  placeholder="Search repositories..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              <button
                onClick={() => setShowTokenInput(!showTokenInput)}
                className={`p-2 rounded-lg transition-colors ${githubToken ? 'text-green-400 bg-green-500/10' : 'text-slate-400 hover:text-purple-400 hover:bg-purple-500/10'}`}
                title={githubToken ? 'GitHub token set (5000 req/hr)' : 'Add GitHub token for 5000 req/hr'}
              >
                <Key className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Filters */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Token Input */}
        {showTokenInput && (
          <div className="mb-4 bg-slate-800 border border-slate-700 rounded-lg p-4">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              GitHub Personal Access Token (optional)
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                placeholder="ghp_xxxxxxxxxxxx"
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <button
                onClick={() => {
                  setGithubToken('')
                  setShowTokenInput(false)
                }}
                className="px-4 py-2 text-slate-400 hover:text-slate-200"
              >
                Clear
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Without token: 60 requests/hour. With token: 5000 requests/hour.
              <a 
                href="https://github.com/settings/tokens/new" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 ml-1"
              >
                Create token →
              </a>
            </p>
          </div>
        )}

        {/* Rate Limit Warning */}
        {rateLimited && (
          <div className="mb-4 bg-amber-500/10 border border-amber-500/50 rounded-lg p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-amber-400 font-medium">
                GitHub API rate limit reached (60 req/hr without token)
              </p>
              <p className="text-amber-300/80 text-sm">
                {!githubToken ? 'Add a GitHub token above for 5000 requests/hour, or wait 1 minute.' : 'Please wait 1 minute for the rate limit to reset.'}
              </p>
            </div>
            {!githubToken && (
              <button
                onClick={() => setShowTokenInput(true)}
                className="px-3 py-1 bg-purple-500 text-white text-sm rounded-lg hover:bg-purple-600 transition-colors"
              >
                Add Token
              </button>
            )}
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-400" />
              <span className="text-sm text-slate-400">Time Range:</span>
            </div>
            <div className="flex bg-slate-800 rounded-lg p-1">
              {['daily', 'weekly', 'monthly'].map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                    timeRange === range
                      ? 'bg-purple-500 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {range.charAt(0).toUpperCase() + range.slice(1)}
                </button>
              ))}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={languageFilter}
              onChange={(e) => setLanguageFilter(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="">All Languages</option>
              <option value="javascript">JavaScript</option>
              <option value="typescript">TypeScript</option>
              <option value="python">Python</option>
              <option value="java">Java</option>
              <option value="go">Go</option>
              <option value="rust">Rust</option>
              <option value="cpp">C++</option>
              <option value="c">C</option>
              <option value="csharp">C#</option>
              <option value="php">PHP</option>
              <option value="ruby">Ruby</option>
              <option value="swift">Swift</option>
              <option value="kotlin">Kotlin</option>
            </select>
          </div>
        </div>

        {/* Results Count */}
        <div className="mb-4">
          <p className="text-slate-400 text-sm">
            Showing {filteredRepos.length} trending repositories
            {rateLimited && ' (basic info only)'}
          </p>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 text-center">
            <p className="text-red-400">{error}</p>
            <button
              onClick={fetchTrendingRepos}
              className="mt-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Repository Grid */}
        {!loading && !error && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredRepos.map((repo) => (
              <div
                key={repo.id}
                className="repo-card bg-slate-800 border border-slate-700 rounded-xl p-5 hover:border-purple-500/50"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <img
                      src={repo.owner.avatar_url}
                      alt={repo.owner.login}
                      className="w-10 h-10 rounded-full border-2 border-slate-600"
                    />
                    <div>
                      <h3 className="font-semibold text-slate-100 text-sm">
                        {repo.owner.login}/{repo.name}
                      </h3>
                      <p className="text-xs text-slate-400">
                        {new Date(repo.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <a
                    href={repo.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 text-slate-400 hover:text-purple-400 hover:bg-purple-500/10 rounded-lg transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
                
                <div className="mb-3">
                  <p className={`text-slate-300 text-sm mb-2 ${expandedRepo === repo.id ? '' : 'line-clamp-3'}`}>
                    {getDescription(repo)}
                  </p>
                  {repoDetails[repo.id]?.enhancedDescription?.length > 150 && (
                    <button
                      onClick={() => setExpandedRepo(expandedRepo === repo.id ? null : repo.id)}
                      className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1"
                    >
                      {expandedRepo === repo.id ? (
                        <><ChevronUp className="w-3 h-3" /> Show less</>
                      ) : (
                        <><ChevronDown className="w-3 h-3" /> Show more</>
                      )}
                    </button>
                  )}
                </div>
                
                {/* Topics/Tags */}
                {repoDetails[repo.id]?.topics && repoDetails[repo.id].topics.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {repoDetails[repo.id].topics.slice(0, 4).map((topic) => (
                      <span
                        key={topic}
                        className="px-2 py-0.5 bg-purple-500/20 text-purple-300 text-xs rounded-full"
                      >
                        {topic}
                      </span>
                    ))}
                    {repoDetails[repo.id].topics.length > 4 && (
                      <span className="px-2 py-0.5 text-slate-500 text-xs">
                        +{repoDetails[repo.id].topics.length - 4}
                      </span>
                    )}
                  </div>
                )}
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1 text-amber-400">
                      <Star className="w-4 h-4" />
                      <span className="text-sm font-medium">
                        {formatNumber(repo.stargazers_count)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-blue-400">
                      <GitFork className="w-4 h-4" />
                      <span className="text-sm font-medium">
                        {formatNumber(repo.forks_count)}
                      </span>
                    </div>
                  </div>
                  
                  {repo.language && (
                    <span className="px-2 py-1 bg-slate-700 text-slate-300 text-xs rounded-full">
                      {repo.language}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && filteredRepos.length === 0 && (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🔍</div>
            <h3 className="text-xl font-semibold text-slate-300 mb-2">
              No repositories found
            </h3>
            <p className="text-slate-400">
              Try adjusting your search or filters
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default App

/**
 * Generate a weekly report of closed issues and merged PRs for each of the
 * Openverse repos.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

import yaml from 'js-yaml'
import axios from 'axios'
import { Octokit } from '@octokit/rest'
import core form '@actions/core'

import { escapeHtml } from './utils/html.mjs'


/**
 * Retrieves and ensures required environment variables exist
 * @returns {string[]} containing environment variables 
 */
const getEnvironmentVariables = (core) => {

  /** the personal access token for the GitHub API */
  const pat = process.env.ACCESS_TOKEN
  /** the username for the Make site account making the post */
  const username = process.env.MAKE_USERNAME
  /** the application password, not login password, for the Make site */
  const password = process.env.MAKE_PASSWORD

  if (!pat) {
    core.notice('GitHub personal access token "ACCESS_TOKEN" is required.')
  }
  if (!username) {
    core.notice('Make site username "MAKE_USERNAME" is required.')
  }
  if (!password) {
    core.notice('Make site application password "MAKE_PASSWORD" is required.')
  }
  if (!(pat && username && password)) process.exit(1)

  return [pat, username, password]
}





/**
 * Read GitHub information from the data files 
 * @returns {Array} containing all repos to report
 */
const getRepos = () => {
  const githubDataFile = resolve('../data/github.yml') // resolved from `package.json`
  const githubInfo = yaml.load(readFileSync(githubDataFile))
  const org = githubInfo.org
  const repos = Object.values(githubInfo.repos)
  return repos
}


/**
 * Returns the start date for closed issues/PRs
 * @returns {Date[]} - contains start and end date
 */
const getDates = () => {
  const msInWeeks = (weeks) => weeks * 7 * 24 * 60 * 60 * 1e3
  // End date is always today
  const [endDate] = new Date().toISOString().split('T')
  // Start date is one week before today
  const [startDate] = new Date(new Date().getTime() - msInWeeks(1))
    .toISOString()
    .split('T')
  return [startDate, endDate]
}

/* GitHub API */
const mergedPrsQ = (repo) =>
  `repo:${org}/${repo} is:pr is:merged merged:>=${startDate}`
const closedIssuesQ = (repo) =>
  `repo:${org}/${repo} is:issue is:closed closed:>=${startDate}`

/* Format issues, PRs and repos as HTML */

/**
 * Generate the HTML for one closed issues or merged PRs section.
 *
 * @param {string} title - the title to use for the section
 * @param {{html_url: string, number: int, title: string}[]} items - the list of issues/PRs
 * @returns {string[]} - lines of HTML
 */
const getItemsHtml = (title, items) => {
  if (!items.length) return []

  return [
    `<h3>${title}</h3>`,
    '<ul>',
    ...items.map((item) => {
      const href = item.html_url
      const number = `#${item.number}`
      const title = escapeHtml(item.title)
      return `<li><a href="${href}">${number}</a>: ${title}`
    }),
    '</ul>',
  ]
}

/**
 * Generate the HTML for the closed issues or merged PRs of one repository.
 *
 * @param {string} repo - the name of the repository
 * @param {{html_url: string, number: int, title: string}[]} mergedPrs - the list of PRs
 * @param {{html_url: string, number: int, title: string}[]} closedIssues - the list of issues
 * @returns {string[]} - lines of HTML
 */
const getRepoHtml = ({ repo, mergedPrs, closedIssues }) => {
  return [
    `<h2><a href="https://github.com/${org}/${repo}">${repo}</a></h2>`,
    ...getItemsHtml('Merged PRs', mergedPrs),
    ...getItemsHtml('Closed issues', closedIssues),
  ]
}

/* Create post on Make site. */

/**
 * Post the activities to the Make site.
 * @param {{
 *   repo: string,
 *   mergedPrs: {html_url: string, number: int, title: string}[],
 *   closedIssues: {html_url: string, number: int, title: string}[]
 * }[]} activities - the list of repos and their activities
 * @returns {Promise} - the response for the POST request
 */
const postActivities = (activities) => {
  const report = activities.map(getRepoHtml).flat().join('\n')

  const MAKE_SITE_API = 'https://make.wordpress.org/openverse/wp-json/wp/v2/'
  const token = Buffer.from(`${username}:${password}`).toString('base64')

  return axios.post(
    'posts',
    {
      title: `A week in Openverse: ${startDate} - ${endDate}`,
      slug: `last-week-openverse-${startDate}-${endDate}`,
      excerpt: `The developments in Openverse between ${startDate} and ${endDate}`,
      content: report,
      status: 'publish',
      tags: [
        3, // openverse
        5, // week-in-openverse
      ],
    },
    {
      baseURL: MAKE_SITE_API,
      headers: {
        Authorization: `Basic ${token}`,
      },
    }
  )
}

/**
 *This is the entrypoint of the script
 *
 *@param octokit {import('@octokit/rest').Octokit} Octokit instance to use
 *@param core {import('@actions/core').core} core logger
 */
export const main = async (octokit, core) => {

  const [pat, username, password] = getEnvironmentVariables()
  const repos = getRepos()
  const [startDate, endDate] = getDates()
  const reports = createReport(octokit, repos)
  const res = await postActivities(reports)
  if (res.status !== 201) {
    core.error('Create post request failed. See the logs.')
    process.exitCode = 1
  }
  core.info(JSON.stringify(res.data, null, 2))
}

/**
 * Finds all closed issues and PRs and returns them
 *
 * @param octokit {import('@octokit/rest').Octokit} Octokit instance
 * @returns {Array} containing all closed issues and merged PRs
 */
const createReport = (octokit, repos) => {
	
  const reportData = []
  for (const repo of repos) {
    const closedIssues = (
      await octokit.rest.search.issuesAndPullRequests({ q: closedIssuesQ(repo) })
    ).data.items
    const mergedPrs = (
      await octokit.rest.search.issuesAndPullRequests({ q: mergedPrsQ(repo) })
    ).data.items
    if (closedIssues.length || mergedPrs.length)
      reportData.push({ repo, closedIssues, mergedPrs })
  }

  return reportData
}


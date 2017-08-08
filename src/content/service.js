import path from 'path'
import fs from 'fs'

import _ from 'lodash'
import Promise from 'bluebird'
import glob from 'node-glob'
import uuid from 'uuid'

import helpers from '../database/helpers'

module.exports = ({ db, projectLocation, logger }) => {

  let categories = []

  async function scanAndRegisterCategories() {
    categories = []
    
    const formDir = path.resolve(projectLocation, '/content/forms')
    
    if (!await fs.exists(formDir)) {
      return categories
    }

    const searchOptions = { cwd: formDir }
    const files = await Promise.fromCallback(callback => glob('**.form.js', searchOptions))

    files.forEach(file => {
      try {
        const category = eval('require')(file) // Dynamic loading require eval for Webpack
        const requiredFields = ['id', 'title', 'ummBloc', 'jsonSchema']

        requiredFields.forEach(field => {
          if (_.isNil(category[field])) {
            throw new Error('"id" is required but missing')
          }
        })

        category.id = category.id.toLowerCase()

        if (_.find(categories, { id: category.id })) {
          throw new Error('There is already a form with id=' + category.id)
        }

        categories.push(category)
      } catch (err) {
        logger.warn('[Content Manager] Could not load Form: ' + file, err)
      }
    })

    return categories
  }

  async function listAvailableCategories() {
    const knex = await db.get()

    return await Promise.mapAll(categories, async category => {

      const count = await knex('content_items')
      .where({ categoryId: category.id })
      .select(knex.raw('count(*) as count'))
      .then().get(0).then(row => (row && row.count) || 0)

      return {
        id: category.id,
        title: category.title,
        description: category.description,
        count: count
      }
    })
  }

  async function getCategorySchema(categoryId) {
    const category = _.find(categories, { id: categoryId })
    if (_.isNil(category)) {
      return null
    }

    return {
      json: category.jsonSchema,
      ui: category.uiSchema,
      title: category.title,
      description: category.description,
      ummBloc: category.ummBloc
    }
  }

  async function createCategoryItem({ categoryId, formData }) {
    categoryId = categoryId && categoryId.toLowerCase()
    const category = _.find(categories, { id: categoryId })

    if (_.isNil(category)) {
      throw new Error(`Category "${categoryId}" is not a valid registered categoryId`)
    }


    if (_.isNil(formData) || !_.isObject(formData)) {
      throw new Error('"formData" must be a valid Json object')
    }

    const metadata = (category.computeMetadata && await category.computeMetadata(formData)) || {}
    const previewText = (category.computePreviewText && await category.computePreviewText(formData)) 
      || 'No preview'
    
    const randomId = `${categoryId}-${uuid.v4().split('-').join('').substr(0, 6)}`

    const knex = await db.get()

    return await knex('content_items').insert({
      id: randomId,
      formData: JSON.stringify(formData),
      metadata: JSON.stringify(metadata),
      categoryId: categoryId,
      previewText: previewText,
      created_by: 'admin',
      created_on: helpers(knex).date.now()
    })
  }

  async function listCategoryItems(categoryId) {
    const knex = await db.get()

    let items = null

    if (categoryId) {
      items = await knex('content_items').where({
        categoryId: categoryId
      }).then()
    } else {
      items = await knex('content_items').then()
    }

    return items.map(transformCategoryItem)
  }

  function transformCategoryItem(item) {
    return item
  }

  async function deleteCategoryItems(ids) {
    if (!_.isArray(ids) || _.some(ids, id => !_.isString(id))) {
      throw new Error('Expected an array of Ids to delete')
    }

    const knex = await db.get()

    return knex('content_items').whereIn('categoryId', ids).del()
  }

  return { 
    scanAndRegisterCategories,
    listAvailableCategories,
    getCategorySchema,
    
    createCategoryItem,
    listCategoryItems,
    deleteCategoryItems

    // getItem,
    // getItemsByMetadata
  }
}
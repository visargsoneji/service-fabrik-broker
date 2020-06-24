package dynamic

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	logf "sigs.k8s.io/controller-runtime/pkg/runtime/log"
	"sigs.k8s.io/yaml"
)

var log = logf.Log.WithName("dynamic")

// StringToUnstructured converts a yaml string to array of unstructured objects
func StringToUnstructured(contentString string) ([]*unstructured.Unstructured, error) {
	contents := strings.Split(contentString, "---")
	res := make([]*unstructured.Unstructured, 0, len(contents))

	for _, content := range contents {
		trimmedContent := strings.Trim(content, "\n")
		if trimmedContent == "" {
			continue
		}
		obj := &unstructured.Unstructured{}

		var body interface{}
		err := yaml.Unmarshal([]byte(trimmedContent), &body)
		if err != nil {
			log.Error(err, "StringToUnstructured: failed to unmarshal yaml")
			return nil, errors.NewUnmarshalError("unable to unmarshal from yaml", err)
		}
		body = MapInterfaceToMapString(body)

		switch x := body.(type) {
		case map[string]interface{}:
			obj.Object = x
		default:
			err := fmt.Errorf("failed to convert %s to unstructured", contentString)
			log.Error(err, "StringToUnstructured: default case failed")
			return nil, errors.NewConvertError("unable to convert to unstructured", err)
		}
		res = append(res, obj)
	}
	return res, nil
}

// MapInterfaceToMapString converts map[interface{}]interface{}
// to map[string]interface{}
func MapInterfaceToMapString(v interface{}) interface{} {
	switch x := v.(type) {
	case map[interface{}]interface{}:
		m := map[string]interface{}{}
		for k, v2 := range x {
			switch k2 := k.(type) {
			case string:
				m[k2] = MapInterfaceToMapString(v2)
			default:
				m[fmt.Sprint(k)] = MapInterfaceToMapString(v2)
			}
		}
		v = m

	case []interface{}:
		for i, v2 := range x {
			x[i] = MapInterfaceToMapString(v2)
		}
	}

	return v
}

// ObjectToMapInterface converts an Object to map[interface{}]interface{}
func ObjectToMapInterface(obj interface{}) (map[string]interface{}, error) {
	values := make(map[string]interface{})
	options, err := json.Marshal(obj)
	if err != nil {
		log.Error(err, "ObjectToMapInterface: unable to marshal to json")
		return nil, errors.NewMarshalError("unable to marshal to json", err)
	}
	err = json.Unmarshal(options, &values)
	if err != nil {
		log.Error(err, "ObjectToMapInterface: unable to unmarshal to json")
		return nil, errors.NewUnmarshalError("unable to unmarshal from json", err)
	}
	return values, nil
}

// DeepUpdate copies the different fields from new to old
func DeepUpdate(currentObj, newObj interface{}) (interface{}, bool) {
	toBeUpdated := false
	switch new := newObj.(type) {
	case map[string]interface{}:
		current := currentObj.(map[string]interface{})
		for updateKey, value := range new {
			//If the existing resource doesnot have the field add it
			if foundField, ok := current[updateKey]; !ok {
				current[updateKey] = value
				toBeUpdated = true
			} else {
				updatedVal, ok := DeepUpdate(foundField, value)
				if ok {
					current[updateKey] = updatedVal
					toBeUpdated = true
				}
			}
		}
		return current, toBeUpdated
	case []interface{}:
		current := currentObj.([]interface{})
		currentLen := len(current)
		for i, val := range new {
			if i < currentLen {
				updatedVal, ok := DeepUpdate(current[i], val)
				if ok {
					current[i] = updatedVal
					toBeUpdated = true
				}
			} else {
				current = append(current, new[i:]...)
				toBeUpdated = true
				return current, toBeUpdated
			}
		}
		return current, toBeUpdated
	case []map[string]interface{}:
		current := currentObj.([]map[string]interface{})
		currentLen := len(current)
		for i, val := range new {
			if i < currentLen {
				updatedVal, ok := DeepUpdate(current[i], val)
				if ok {
					current[i] = updatedVal.(map[string]interface{})
					toBeUpdated = true
				}
			} else {
				current = append(current, new[i:]...)
				toBeUpdated = true
				return current, toBeUpdated
			}
		}
		return current, toBeUpdated
	default:
		if !reflect.DeepEqual(currentObj, newObj) {
			currentObj = newObj
			toBeUpdated = true
		}
		return currentObj, toBeUpdated
	}
}
